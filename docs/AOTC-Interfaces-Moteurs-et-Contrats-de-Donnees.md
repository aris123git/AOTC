# AOTC — Interfaces des Moteurs & Contrats de Données

> Document de référence des **interfaces inter-moteurs** et des **contrats de données** échangés.
> Complète : *Architecture Fonctionnelle et Métier* et l'architecture technique.
> Objectif : figer les frontières et les messages afin que le développement avance sans remettre en cause les fondations.
> **Convention de typage :** TypeScript + Zod (source de vérité dans `packages/contracts`). Tous les montants sont en **entiers (minor units) XOF**, tous les horodatages en **ISO-8601 UTC**.

---

## 0. Principes de contractualisation

1. **Deux plans de communication** :
   - **Asynchrone (Message Bus)** pour les faits/événements (event sourcing) : Redis Streams → NATS.
   - **Synchrone (RPC/HTTP interne)** pour les *décisions bloquantes* à faible latence (ex. contrôle pré-trade, cotation d'un prix).
2. **Idempotence obligatoire** : toute commande porte une clé (`command_id` / `client_order_id` / `idempotency_key`).
3. **Enveloppe commune** pour tout message (voir §2).
4. **Versionnage** : chaque contrat porte `schema_version` ; changements rétro-compatibles seulement (ou nouveau topic).
5. **Corrélation** : `correlation_id` traverse toute la chaîne (ordre → risk → pricing → matching → settlement → ledger) pour l'audit et le NOC.
6. **Aucun couplage direct** entre moteurs : ils ne se connaissent que par ces contrats.

---

## 1. Cartographie des moteurs et de leurs responsabilités

| Moteur | Entrées | Sorties | Mode |
|---|---|---|---|
| **Trading Engine** | `OrderAccepted` | `OrderMatched`, `OrderRested`, `TradeExecuted` | Async (mono-writer/instrument) |
| **Risk Engine** | `OrderRequested`, flux post-trade | `RiskDecision`, `RiskAlert`, `KillSwitch` | Sync (pré-trade) + Async (post-trade) |
| **Pricing Engine** | `QuoteRequested`, market data | `QuoteProvided` (spread/prix) | Sync (cotation) + Async (publication) |
| **Liquidity Engine** | `LiquidityInterventionRequested` | `LiquidityDecision` | Sync + Async |
| **Treasury Engine** | `FundsReservationRequested`, `FundsReleaseRequested` | `FundsReserved`, `FundsRejected` | Sync |
| **Settlement Engine** | `TradeExecuted` | `SettlementInstructed`, `SettlementConfirmed/Failed` | Async |
| **Smart Order Router (SOR)** | `OrderAccepted` | `RoutingDecision` | Sync |
| **Market Data Service** | flux BRVM / interne | `PriceTick`, `BookSnapshot`, `Candle`, `CorporateAction` | Async (publication) |
| **Partner Management Engine** | flux trades/commissions | `PartnerStatsUpdated` | Async (agrégation) |
| **Monitoring Engine** | tous les événements | `MarketAbuseAlert` | Async (consumer) |
| **AI Engine** (réservé) | tous les événements (lecture) | (aucune sortie active au MVP) | Async (consumer) |

```
OrderRequested ─▶ Risk(pré-trade) ─▶ Treasury(réserve) ─▶ SOR ─▶ Pricing(quote)
      │                                                     │
      └──────────────────────── OrderAccepted ─────────────┘
                                     │
                                Trading Engine ─▶ TradeExecuted ─▶ Settlement
                                     │                    │
                              (si pas de contrepartie)    └─▶ Ledger / Treasury / Partner
                                     ▼
                              Liquidity Engine ─▶ (SGI_PARTNER) inventaire
```

---

## 2. Enveloppe de message commune (Message Bus)

Tous les messages async partagent cette enveloppe.

```ts
interface Envelope<T> {
  message_id: string;        // UUID unique du message (idempotence de transport)
  schema_version: string;    // ex: "1.0"
  type: string;              // ex: "TradeExecuted"
  occurred_at: string;       // ISO-8601 UTC (fait métier)
  correlation_id: string;    // traverse toute la chaîne
  causation_id?: string;     // message_id du message déclencheur
  actor?: { id: string; role: "investor"|"sgi_agent"|"aotc_admin"|"super_admin"|"system" };
  tenant?: { sgi_id?: string };   // multi-tenant SGI
  environment: "sandbox" | "production";  // cf. §12 Sandbox Mode
  payload: T;
}
```

Topics (Redis Streams / NATS subjects), convention `aotc.<domaine>.<evenement>` :

```
aotc.orders.requested        aotc.orders.accepted        aotc.orders.rejected
aotc.trading.matched         aotc.trading.rested         aotc.trading.trade
aotc.risk.decision           aotc.risk.alert             aotc.risk.killswitch
aotc.pricing.quote           aotc.liquidity.decision
aotc.treasury.reserved       aotc.treasury.released
aotc.settlement.instructed   aotc.settlement.confirmed   aotc.settlement.failed
aotc.marketdata.tick         aotc.marketdata.candle      aotc.marketdata.corporate_action
aotc.partner.stats           aotc.monitoring.alert
```

---

## 3. Modèle d'actif générique (`Asset`)

Les actions ne sont qu'un **type** d'actif. Le moteur raisonne sur `Asset`.

```ts
type AssetClass = "equity" | "bond" | "govt_bond" | "sukuk" | "mutual_fund" | "etf";

interface Asset {
  id: string;
  symbol: string;            // ex: SNTS
  isin?: string;
  asset_class: AssetClass;
  name: string;
  currency: "XOF";
  status: "listed" | "suspended" | "delisted";
  tick_size: number;         // minor units
  lot_size: number;
  // Attributs spécifiques par classe (déportés, non nuls seulement si pertinents)
  equity?: { sector: string };
  bond?:   { coupon_bps: number; maturity: string; face_value: number; accrual: "actual/360"|"30/360" };
  sukuk?:  { profit_rate_bps: number; maturity: string; sharia_board_ref: string };
  fund?:   { nav: number; nav_frequency: "daily"|"weekly"; isin_share_class: string };
}
```

Règle : tout contrat qui référence un instrument utilise `asset_id` (jamais le symbole seul), afin que l'ajout d'obligations/sukuks/OPCVM/ETF ne casse rien.

---

## 4. Contrat — Ordre & routage

### 4.1 `OrderRequested` (API → Risk, sync via RPC + publication async)

```ts
interface OrderRequested {
  client_order_id: string;   // idempotence côté client
  user_id: string;
  sgi_id: string;
  asset_id: string;
  side: "buy" | "sell";
  order_type: "market" | "limit";
  tif: "gtc" | "day" | "ioc" | "fok";
  qty: number;               // entier (lots * lot_size)
  price_limit?: number;      // requis si order_type = "limit"
}
```

### 4.2 `RiskDecision` (Risk → API, sync)

```ts
interface RiskDecision {
  client_order_id: string;
  approved: boolean;
  reasons: string[];               // vide si approved
  checks: {                        // traçabilité des contrôles
    kyc_ok: boolean;
    market_open: boolean;
    asset_tradable: boolean;
    funds_or_holdings_ok: boolean;
    within_limits: boolean;
  };
  reservation_ref?: string;        // renvoyé par Treasury si fonds/titres verrouillés
}
```

### 4.3 `RoutingDecision` (SOR → Trading, sync)

```ts
interface RoutingDecision {
  client_order_id: string;
  route: "internal_book" | "sgi_counterparty" | "aotc_liquidity" | "external_venue";
  venue_ref?: string;              // SGI ou place cible
  rationale: {                     // politique de meilleure exécution (auditable)
    criteria: ("best_price"|"speed"|"available_liquidity"|"cost"|"best_execution_policy")[];
    reference_price: number;
    expected_price?: number;
  };
}
```

### 4.4 `OrderAccepted` (→ Trading Engine, async)

Émis une fois Risk `approved` + Treasury réservé + SOR routé. Contient l'ordre normalisé + `reservation_ref` + `route`.

---

## 5. Contrat — Pricing Engine

Isole **le calcul du spread/prix** du Matching. Le Trading/SOR/Liquidity demandent une cotation ; le Pricing décide.

### 5.1 `QuoteRequested` (Liquidity/SOR → Pricing, sync)

```ts
interface QuoteRequested {
  asset_id: string;
  side: "buy" | "sell";
  qty: number;
  purpose: "liquidity_intervention" | "indicative" | "display";
}
```

### 5.2 `QuoteProvided` (Pricing → demandeur, sync + publication)

```ts
interface QuoteProvided {
  asset_id: string;
  reference_price: number;         // prix de référence (officiel/mid)
  spread_bps: number;              // spread appliqué
  price: number;                   // reference_price ± spread, borné par tick_size
  side: "buy" | "sell";
  factors: {                       // explicabilité (audit + futur AI)
    liquidity_factor: number;
    volatility_factor: number;
    risk_factor: number;
    session_factor: number;        // heures de marché
  };
  valid_until: string;             // ISO-8601 : durée de validité de la cotation
}
```

Règle : le Trading Engine n'interprète jamais un spread ; il applique un `price` déjà coté. Modifier la politique de spread = modifier le Pricing Engine seul.

---

## 6. Contrat — Trading Engine (matching)

### 6.1 `TradeExecuted` (Trading → Settlement/Ledger/Treasury/Partner, async)

```ts
interface TradeExecuted {
  trade_id: string;
  asset_id: string;
  buy_order_id: string;
  sell_order_id: string;
  qty: number;
  price: number;
  buyer_sgi_id: string;
  seller_sgi_id: string;
  aotc_as_principal: boolean;      // true si inventaire liquidité impliqué (mode SGI_PARTNER)
  liquidity_source: "internal_book" | "sgi_counterparty" | "aotc_liquidity" | "external_venue";
  executed_at: string;
}
```

### 6.2 `OrderRested` / `OrderMatched`
- `OrderRested` : ordre inscrit au book (aucune/partielle exécution) → alimente `BookSnapshot`.
- `OrderMatched` : mise à jour `qty_filled`, `status` (partial/filled).

---

## 7. Contrat — Liquidity Engine & Treasury Engine

**Séparation clé demandée :** le Liquidity Engine décide **quand** intervenir ; le Treasury Engine gère **avec quels fonds**.

### 7.1 `LiquidityInterventionRequested` (Trading → Liquidity, sync/async)

```ts
interface LiquidityInterventionRequested {
  asset_id: string;
  side: "buy" | "sell";     // côté que l'inventaire doit prendre
  qty: number;
  correlation_id: string;
}
```

### 7.2 `LiquidityDecision` (Liquidity → Trading, sync)

```ts
interface LiquidityDecision {
  approved: boolean;
  reasons: string[];
  quote_ref?: string;              // QuoteProvided utilisé
  exposure_after?: {               // limites multi-niveaux vérifiées
    by_asset: number;
    by_sgi: number;
    by_sector: number;
    global: number;
  };
  treasury_reservation_ref?: string;
  liquidity_mode: "SGI_PARTNER" | "AOTC_PRINCIPAL";
}
```

### 7.3 Treasury Engine

```ts
interface FundsReservationRequested {
  reservation_id: string;          // idempotence
  purpose: "order_cash_lock" | "liquidity_intervention";
  amount: number;                  // XOF minor units
  source_hint?: "aotc_own" | "coris" | "credit_line";
  correlation_id: string;
}
interface FundsReserved {
  reservation_id: string;
  approved: boolean;
  source: "aotc_own" | "coris" | "credit_line";
  available_after: number;         // trésorerie disponible restante
  reasons: string[];
}
// Autres : FundsReleaseRequested, FundsSettled (revenus de liquidité comptabilisés)
```

Le Treasury Engine expose l'état : `available_cash`, `immobilized`, `credit_lines[]`, `liquidity_revenue`, `capital_by_source` (propre / Coris).

---

## 8. Contrat — Settlement Engine (RL T+3)

```ts
interface SettlementInstructed {
  settlement_id: string;
  trade_id: string;
  asset_id: string;
  qty: number; amount: number;
  buyer_sgi_id: string; seller_sgi_id: string;
  settlement_date: string;         // T+3 (date)
  status: "instructed";
}
interface SettlementConfirmed { settlement_id: string; confirmed_at: string; }
interface SettlementFailed {
  settlement_id: string;
  reason: "counterparty_default" | "reconciliation_mismatch" | "sgi_timeout" | "other";
  detail?: string;
}
```

Réconciliation quotidienne : `SettlementFailed` ou écart → `RiskAlert` + gel ciblé (cf. cas d'exception).

---

## 9. Contrat — Market Data Service

```ts
interface PriceTick { asset_id: string; last: number; mid: number; ts: string; source: "brvm_official" | "aotc_computed"; }
interface BookSnapshot { asset_id: string; bids: {price:number; qty:number}[]; asks: {price:number; qty:number}[]; ts: string; }
interface Candle { asset_id: string; tf: "1m"|"1h"|"1d"; o:number; h:number; l:number; c:number; v:number; ts: string; }
interface CorporateAction { asset_id: string; kind: "dividend"|"split"|"rights_issue"|"coupon"|"redemption"; ex_date: string; details: Record<string, unknown>; }
```

Séparation explicite `brvm_official` vs `aotc_computed` (transparence réglementaire).

---

## 10. Contrat — Partner Management Engine

Agrège, par SGI (multi-tenant), les métriques attendues par les partenaires.

```ts
interface PartnerStatsUpdated {
  sgi_id: string;
  period: string;                  // ex: "2026-07"
  volume_brought: number;          // volume apporté
  revenue_generated: number;       // CA généré
  commissions: number;             // commissions (commission_bps)
  market_share_bps: number;        // part de marché
  performance: { fill_rate: number; avg_execution_ms: number };
  updated_at: string;
}
```

---

## 11. Contrat — Monitoring / NOC / Risk alerts

### 11.1 `MarketAbuseAlert` (Monitoring → NOC/Risk, async)

```ts
interface MarketAbuseAlert {
  alert_id: string;
  asset_id?: string; sgi_id?: string; user_id?: string;
  pattern: "abnormal_price" | "unusual_volume" | "wash_trading" | "spoofing" | "layering";
  severity: "low" | "medium" | "high" | "critical";
  evidence: Record<string, unknown>;   // références aux ordres/trades
  detected_at: string;
}
```

### 11.2 Supervision opérationnelle (NOC)

Le NOC est un **consumer** de tous les topics + une API de lecture temps réel :

```ts
interface OpsSnapshot {
  ts: string;
  orders_per_min: number;
  failures: { rejected_orders: number; failed_payments: number; failed_settlements: number };
  pending: { payments: number; settlements: number };
  risk_alerts_open: number;
  engines_health: Record<"trading"|"liquidity"|"treasury"|"settlement"|"risk"|"pricing"|"sor"|"marketdata", "up"|"degraded"|"down">;
}
```

Alimente Grafana/Prometheus/Sentry ; expose un tableau NOC dans la console AOTC.

---

## 12. Sandbox Mode (contrat transverse)

- Champ `environment: "sandbox" | "production"` dans **chaque** enveloppe.
- **Isolation stricte** : topics, données et soldes séparés ; aucune instruction RL réelle, aucun paiement réel (PSP en mode simulé).
- Permet aux SGI et à Coris de tester avec données fictives, sans impact marché.
- Les moteurs partagent le même code ; seul le routage des ressources (DB schema/prefix, streams, connecteurs) diffère selon `environment`.

---

## 13. Règles de cohérence entre contrats (invariants)

1. Un `TradeExecuted` référence toujours des ordres passés par `Risk` (`approved`) et réservés par `Treasury`.
2. Un ordre `aotc_as_principal = true` implique un `LiquidityDecision.approved` **et** un `FundsReserved` Treasury.
3. Un `QuoteProvided.price` est borné par `tick_size` de l'`Asset`.
4. Toute intervention liquidité respecte les limites `by_asset`/`by_sgi`/`by_sector`/`global`.
5. `correlation_id` est constant de `OrderRequested` jusqu'à `SettlementConfirmed`.
6. Aucun message `production` ne peut être consommé par une ressource `sandbox` (et inversement).

---

## 14. Matrice sync vs async (récapitulatif)

| Interaction | Mode | Pourquoi |
|---|---|---|
| API → Risk (pré-trade) | Sync | Décision bloquante avant acceptation |
| Risk → Treasury (réservation) | Sync | Verrou de fonds/titres immédiat |
| SOR → Pricing (cotation) | Sync | Prix nécessaire au routage |
| Trading → Liquidity → Treasury | Sync | Décision d'intervention immédiate |
| Trading → Settlement | Async | RL T+3, pas de blocage |
| Tout → Monitoring/AI/Partner/NOC | Async | Observation/agrégation |
| Market Data → tous | Async | Publication/fan-out |

---

## 15. Nouveaux moteurs introduits (vs document précédent)

1. **Pricing Engine** — calcul du spread (liquidité, volatilité, risque, session) isolé du Matching.
2. **Treasury Engine** — trésorerie (disponible, immobilisé, lignes de crédit, appels de liquidité, revenus), séparé du Liquidity Engine.
3. **Partner Management Engine** — statistiques SGI (volume, CA, commissions, part de marché, performance).
4. **NOC / Supervision opérationnelle** — vue temps réel exploitation + santé moteurs.
5. **Sandbox Mode** — environnement de test isolé (SGI/Coris), champ `environment` transverse.
6. **Modèle `Asset` générique** — actions = un type parmi obligations, obligations d'État, sukuks, OPCVM, ETF.

---

## 16. Prochaine étape

Ces interfaces et contrats étant figés, le développement du **Lot 1** peut démarrer sans remettre en cause les fondations :

1. `packages/contracts` : implémenter tous les schémas Zod ci-dessus + enveloppe commune + topics.
2. Squelette des moteurs (Trading, Risk, Pricing, Liquidity, Treasury, Settlement, SOR) consommant/produisant ces contrats via le Message Bus (Redis Streams).
3. Modèle `Asset` générique + Market Data simulée (BRVM).
4. Parcours démontrable `inscription → KYC → dépôt simulé → premier ordre` en mode `SGI_PARTNER`, `environment = sandbox`.
