# AOTC — Principes d'Architecture Immutables

> **Statut : FIGÉ — ne doit plus jamais changer sans proposition d'architecture formelle.**
>
> Ces règles précèdent et encadrent tout développement (Lot 1 et suivants).
> Toute évolution majeure (nouveau couplage, accès direct à une techno depuis un moteur, logique BRVM-spécifique dans le domaine) **exige une nouvelle proposition d'architecture** avant intégration.
>
> Date de figement : 2026-07-23.

---

## Préambule

AOTC n'est pas une application web : c'est une **Market Infrastructure Platform**.
La valeur réside dans l'infrastructure (moteurs, contrats, bus, multi-place), pas seulement dans l'UX.

Les six règles ci-dessous sont **non négociables**. Elles protègent contre les refontes coûteuses.

---

## Règle 1 — Le Matching Engine n'accède jamais directement à la base

Le **Trading Engine** (matching) ne communique qu'au travers de :

| Canal | Usage |
|---|---|
| **Message Bus** | Entrées / sorties d'événements (`OrderAccepted`, `TradeExecuted`, …) |
| **Contrats** (`packages/contracts`) | Schémas Zod validés ; aucune structure ad hoc |
| **Repository (port)** | Interfaces définies dans `packages/core` ; implémentations hors moteur |

```
❌  TradingEngine → Postgres / Redis / Supabase client
✔  TradingEngine → OrderBookRepository (port) → adapter (infra)
✔  TradingEngine → MessageBus.publish(TradeExecuted)
```

**Conséquence :** remplacer PostgreSQL ou Redis ne modifie quasiment pas le moteur.

---

## Règle 2 — Les moteurs ne se connaissent jamais

Aucun import croisé entre moteurs. Aucun appel direct `TradingEngine → LiquidityEngine`.

```
❌  Trading Engine appelle Liquidity Engine
✔  Trading Engine publie LiquidityInterventionRequested
✔  Liquidity Engine consomme, décide, publie LiquidityDecision
```

Tout est **piloté par événements** (et RPC sync uniquement via contrats, jamais via références de classes entre moteurs).

**Conséquence :** chaque moteur est déployable, testable et remplaçable isolément.

---

## Règle 3 — Le cœur métier est indépendant des technologies

Le dossier `packages/core` **ne dépend d'aucune** infrastructure :

- ❌ Supabase
- ❌ Next.js / React
- ❌ Redis / NATS
- ❌ Postgres client / ORM

Il contient uniquement : types du domaine, ports (interfaces), invariants, logique pure.

Les adapters vivent dans `packages/*-adapters` ou `engines/*/infra`.

**Conséquence :** le domaine survit à un changement complet de stack.

---

## Règle 4 — Multibourse dès le jour 1

Aujourd'hui : **BRVM**. Demain : BRVM, BVMAC, NGX, JSE, …

Le modèle de domaine **ne contient aucune logique spécifique à la BRVM**.

Hiérarchie obligatoire :

```
Exchange  →  Market  →  Instrument  →  Asset
```

| Entité | Rôle |
|---|---|
| **Exchange** | Place (BRVM, BVMAC, NGX, JSE, …) |
| **Market** | Segment d'une place (actions, obligations, …) |
| **Instrument** | Cotation tradable sur un Market |
| **Asset** | Sous-jacent générique (equity, bond, sukuk, ETF, …) |

Les spécificités d'une place (horaires, tick, calendrier) sont des **données de configuration** rattachées à `Exchange` / `Market`, jamais du code `if (exchange === "BRVM")` dans le domaine.

---

## Règle 5 — Haute disponibilité prévue dès le départ

Même avec un seul serveur au MVP, **chaque moteur est conçu pour être répliqué** :

```
Trading Engine  × N
Risk Engine     × N
Pricing Engine  × N
…
```

Contrainte : **un seul leader par partition de marché** (partition = typiquement `exchange_id + market_id` ou `instrument_id` selon le moteur).

Interfaces obligatoires dans `packages/core` :

- `PartitionKey`
- `LeadershipLease` / `LeaderElectionPort`
- `EngineReplica` (role: `leader` | `follower`)

Les followers consomment (lecture / warm standby) ; seul le leader écrit sur sa partition.

---

## Règle 6 — Decision Engine (intelligence) dès le jour 1

Créer dès maintenant un moteur **Decision Engine**, même vide :

| Capacité future | Statut MVP |
|---|---|
| IA / recommandations | Interface seule |
| Prévision de liquidité | Interface seule |
| Détection d'anomalies | Interface seule |
| Optimisation des spreads | Interface seule |

Il consomme les événements (lecture) et pourra plus tard publier des `DecisionSignal`.
L'implémentation MVP est un **no-op** ; l'interface et le topic sont déjà en place.

> Note : ce moteur remplace / absorbe la vision « AI Engine » du document fonctionnel ; le nom canonique est **Decision Engine**.

---

## Checklist d'acceptation (toute PR)

Avant merge, vérifier :

- [ ] Aucun moteur n'importe un autre moteur
- [ ] Aucun moteur n'importe un client Postgres / Redis / Supabase directement
- [ ] `packages/core` n'a aucune dépendance d'infrastructure
- [ ] Aucune constante / branche `BRVM`-spécifique dans le domaine
- [ ] Les nouveaux messages passent par `packages/contracts` + enveloppe commune
- [ ] Les moteurs exposent / respectent le leadership par partition
- [ ] Decision Engine reste le seul point d'extension « intelligence »

Si une de ces cases est cochée « non » → **proposition d'architecture requise**, pas un hotfix.

---

## Discipline de livraison (Lot 1+)

**Une Pull Request = un moteur ou une fonctionnalité métier complète.**

Exemples : Auth+MFA · KYC · Market Data · Risk · SOR · Trading · Settlement · Liquidity · Simulation Journal.

Interdit : mega-PR touchant plusieurs moteurs « pour avancer plus vite ».
Périmètre Lot 1 : [Scénario E2E](./AOTC-Lot1-Scenario-E2E.md).

---

## Documents liés

1. [Architecture Fonctionnelle et Métier](./AOTC-Architecture-Fonctionnelle-et-Metier.md)
2. [Interfaces des Moteurs & Contrats de Données](./AOTC-Interfaces-Moteurs-et-Contrats-de-Donnees.md)

Ces documents restent la référence métier / contrats. **En cas de conflit avec le présent document, les Principes Immutables prévalent.**
