# AOTC — Architecture Fonctionnelle et Métier

> Document de référence métier de la plateforme **African OTC Exchange (AOTC)**.
> Il précède l'implémentation et complète le document d'architecture technique.
> **Statut :** validé pour servir de base au développement du Lot 1.
> **Mode de liquidité retenu :** `SGI_PARTNER` (SGI partenaire adossée), évolutif vers `AOTC_PRINCIPAL`.

---

## 1. Positionnement et principes directeurs

AOTC est une **infrastructure financière de liquidité**, pas une application de trading isolée ni un dépositaire.

Principes non négociables :

1. **AOTC n'est jamais dépositaire.** Les titres restent : `Investisseur → SGI → DC/BR`.
2. **AOTC ne détient pas la monnaie électronique en propre.** Les flux espèces passent par des PSP/banques agréés (mode `SGI_PARTNER` : la banque/SGI adossée porte les comptes).
3. **AOTC orchestre 4 fonctions cœur** : agrégation de liquidité, routage (SOR), matching, expérience utilisateur.
4. **Tout est auditable et idempotent.** Chaque décision métier est journalisée et rejouable (event sourcing).
5. **Conformité d'abord.** L'architecture doit être approuvable par le CREPMF sans refonte.

### 1.1 Les 4 moteurs cœur (vision « infrastructure »)

AOTC s'articule autour de quatre moteurs métier explicites, plus des services de support.

| Moteur | Rôle métier | Responsabilité clé |
|---|---|---|
| **Trading Engine** | Matching des ordres | Carnet d'ordres, priorité prix/temps (FIFO), exécutions, event sourcing |
| **Liquidity Engine** | Gestion du capital de liquidité et des expositions | Capital propre / Coris / lignes de crédit, limites par titre/SGI/secteur, décision d'intervention |
| **Settlement Engine** | Coordination SGI et règlement-livraison | Instructions RL (T+3), réconciliation des positions miroir, gestion des échecs |
| **Risk Engine** | Limites, alertes, contrôle des risques | Contrôles pré-trade et post-trade, kill-switch, limites de perte, alertes temps réel |

Services de support (prévus dès l'architecture, activés progressivement) :

- **Smart Order Router (SOR)** — sélection de la meilleure destination d'exécution.
- **Market Data Service** — données officielles BRVM, données calculées AOTC, OHLC, corporate actions.
- **Monitoring Engine (surveillance de marché)** — détection d'abus (wash trading, spoofing, layering, volumes anormaux).
- **AI Engine** — réservé (prix juste, détection de fraude, scoring, prévision de liquidité) — inactif au MVP.
- **Message Bus** (Redis Streams au démarrage → NATS/RabbitMQ plus tard) — découplage des services.
- **Cache Redis** — book, derniers prix, sessions, rate limiting, fan-out temps réel.
- **API Gateway** — auth, rate limiting, versioning, logs, API partenaires (banques/fintechs).

```
                         Internet
                            │
                       API Gateway
                            │
                        Order API
                            │
                       Message Bus  (Redis Streams → NATS)
        ┌───────────┬───────────┬───────────┬───────────┐
        ▼           ▼           ▼           ▼           ▼
   Trading      Liquidity   Settlement    Risk      Monitoring
   Engine        Engine       Engine     Engine       Engine
        │           │           │           │           │
        └────────── Postgres (ledger, ordres, trades) ──┘
                     Redis (book/prix/cache)  ·  Market Data
```

---

## 2. Acteurs et périmètre de responsabilité

| Acteur | Rôle | Ce qu'il fait | Ce qu'il ne fait PAS |
|---|---|---|---|
| **Investisseur** | Client final | S'inscrit, KYC, dépose/retire, achète/vend, suit portefeuille | Ne détient pas de compte-titres chez AOTC |
| **SGI** | Intermédiaire agréé | Conserve les titres, exécute les transferts, valide, gagne des commissions | Ne gère pas le matching inter-SGI |
| **SGI/Banque adossée (Coris)** | Partenaire de liquidité (`SGI_PARTNER`) | Porte l'inventaire de liquidité et les comptes espèces réglementairement | — |
| **AOTC** | Infrastructure | Agrège la liquidité, route, matche, gère le risque, fournit l'UX | N'est ni dépositaire ni teneur de compte |
| **Super Admin** | Gouvernance système | Configuration, rôles, sécurité, workflows d'approbation | Actions critiques soumises à double validation |

---

## 3. Flux métier détaillés

### 3.1 Onboarding investisseur

```
Inscription → vérification e-mail/OTP → activation MFA
   → KYC (upload pièces) → contrôle AML/LBC-FT
   → validation SGI/AOTC → rattachement à une SGI
   → compte actif → premier dépôt → prêt à trader
```

Règles :
- KYC obligatoire avant tout ordre réel (portefeuille virtuel accessible avant, cf. §8).
- Rattachement à une SGI obligatoire (la SGI reste propriétaire de la relation client).
- Niveaux de vigilance AML selon montants (seuils configurables, reporting CENTIF).

### 3.2 Cycle de vie d'un ordre (achat/vente)

```
Création ordre (client_order_id idempotent)
   │
   ▼
Risk Engine — contrôles PRÉ-TRADE
   ├─ KYC actif ? instrument tradable ? marché ouvert ?
   ├─ VENTE : holdings.qty_available ≥ qty ? → lock titres
   ├─ ACHAT : cash.available ≥ coût estimé ? → lock fonds
   └─ limites (par ordre, par user, par SGI) respectées ?
   │  (si KO → REJECTED + raison + audit)
   ▼
Smart Order Router — choisit la destination
   ├─ 1) Book interne AOTC (contrepartie investisseur ↔ investisseur)
   ├─ 2) Contrepartie proposée par une/des SGI
   ├─ 3) Inventaire de liquidité (Liquidity Engine, mode SGI_PARTNER)
   └─ 4) (futur) autre place / teneur de marché
   ▼
Trading Engine — matching (priorité prix → temps/FIFO → quantité)
   ├─ match total → FILLED
   ├─ match partiel → PARTIAL (reste OPEN selon TIF)
   └─ aucun match → OPEN (jusqu'à match / expiration / intervention liquidité)
   ▼
Settlement Engine — instruction RL T+3 vers SGI/DC-BR
   ▼
Ledger (double entrée) + mise à jour holdings/cash + notification + audit
```

### 3.3 Scénario clé — Vente sans acheteur (cœur de la vision)

```
Vendeur : vendre 100 SNTS @ marché — aucun acheteur dans le book
   │
   ▼
Liquidity Engine évalue l'intervention :
   ├─ liquidity_config(SNTS).enabled ?
   ├─ exposition(SNTS) + 100 ≤ max_exposure(SNTS) ?
   ├─ limites secteur/SGI respectées ? capital disponible ?
   └─ prix d'intervention = prix_référence − spread_bps
   │
   ├─ OUI → la SGI adossée (mode SGI_PARTNER) achète en principal
   │        trade.aotc_as_principal = true ; inventaire += 100
   │        (revente automatique dès l'arrivée d'acheteurs)
   │
   └─ NON → l'ordre reste OPEN dans le book (transparence : pas d'exécution forcée)
```

Note conformité : le **spread** appliqué est affiché à l'utilisateur et journalisé avec le prix de référence (politique de meilleure exécution auditable, gestion du conflit d'intérêt).

### 3.4 Dépôt / retrait (espèces)

```
Dépôt   : /payments/deposit → PSP (Orange/Moov/Wave/carte) → paiement mobile
          → webhook signé + idempotent (success) → crédit cash + ledger + notif
Retrait : contrôle solde → débit + lock → payout PSP → webhook
          → confirmation (ou rollback + alerte si échec)
```

### 3.5 Règlement-livraison et réconciliation

- Chaque `trade` génère une **instruction de règlement** (T+3).
- Le Settlement Engine tient un **miroir** des positions et **réconcilie quotidiennement** avec les confirmations SGI/DC-BR.
- Tout écart déclenche une alerte Risk Engine et bloque les opérations concernées si nécessaire.

---

## 4. Règles de liquidité (Liquidity Management Engine)

Le capital de liquidité n'est **pas** un simple stock : c'est un actif stratégique modélisé finement.

### 4.1 Sources de capital

| Source | Description | Suivi |
|---|---|---|
| Capital propre AOTC | Fonds propres dédiés à la liquidité | Solde, utilisation, rendement |
| Capital apporté (Coris) | Financement partenaire | Ségrégation comptable, reporting dédié |
| Lignes de crédit | Facilités mobilisables | Plafond, tirage, coût, échéance |

### 4.2 Limites d'exposition (multi-niveaux)

- **Par titre** : `max_exposure(instrument)` en quantité et en montant.
- **Par SGI** : exposition agrégée sur les clients d'une SGI.
- **Par secteur** : concentration sectorielle (banque, télécom, etc.).
- **Globale** : exposition totale vs capital disponible + lignes de crédit.

### 4.3 Politique de prix (spread)

- `spread_bps` paramétrable par titre et par régime de marché.
- Prix d'intervention = `prix_référence ± spread`, borné par `tick_size`.
- Journalisation systématique (prix de référence, spread, décision) pour l'audit.

### 4.4 Modes de liquidité

| Mode | Description | Statut |
|---|---|---|
| `SGI_PARTNER` | La SGI/banque adossée porte l'inventaire réglementairement ; AOTC fournit le capital et la décision | **Retenu (MVP)** |
| `AOTC_PRINCIPAL` | AOTC intervient en compte propre (nécessite agrément CREPMF) | Futur, sans refonte |

Le passage d'un mode à l'autre est un **changement de configuration**, pas d'architecture.

---

## 5. Interactions avec les SGI

- **Propriété client** : la SGI reste propriétaire de la relation ; AOTC ne débauche pas les clients.
- **Conservation & transfert** : titres chez la SGI/DC-BR ; les transferts sont exécutés/validés par la SGI.
- **Espace professionnel SGI** : clients, ordres/volumes, validations de transferts, liquidité, commissions, statistiques, accès API + clé.
- **API partenaire** : endpoints dédiés (clients, ordres, transferts, stats, commissions) exposés via l'API Gateway (versionnés, rate-limités).
- **Commissions** : `commission_bps` par SGI, calculées à l'exécution et réconciliées.

---

## 6. Règles de risque (Risk Engine)

### 6.1 Contrôles pré-trade
- KYC actif, instrument tradable, marché ouvert.
- Fonds/holdings suffisants et verrouillés avant routage.
- Limites par ordre / par utilisateur / par SGI / globales.

### 6.2 Contrôles post-trade
- Suivi d'exposition en continu (inventaire, secteur, SGI).
- Limites de perte (stop global), seuils d'alerte.
- **Kill-switch** : suspension d'un titre / d'une SGI / du marché entier.

### 6.3 Surveillance de marché (Monitoring Engine)
Détection (alertes, pas blocage automatique au MVP) : variation anormale de prix, volume inhabituel, **wash trading**, **spoofing**, **layering**, manipulation potentielle. Chaque alerte est tracée et adressée à l'admin AOTC.

---

## 7. Modèle de données de marché (enrichi)

Les cours ne sont pas une simple table `price`. On distingue :

| Domaine | Contenu | Source |
|---|---|---|
| Données officielles BRVM | Cours de clôture/officiels | Flux BRVM (simulateur au MVP) |
| Données calculées AOTC | Mid, dernier prix interne, VWAP | Trading Engine / calcul interne |
| Indicateurs | Volatilité, volumes, tendances | Dérivés |
| Historique OHLC | Bougies 1m / 1h / 1d | Agrégation |
| Corporate actions | Dividendes, splits, augmentations de capital | Référentiel émetteurs |

Objectif : séparer clairement l'**officiel** du **calculé** (transparence réglementaire) et alimenter TradingView (charts avancés) + Recharts (analytique).

---

## 8. Démocratisation / éducation (vision, hors MVP strict)

- **Espace éducation** : notions de bourse, fonctionnement d'un ordre, risques.
- **Simulateur / portefeuille virtuel** : trading sans argent réel avant KYC complet.
- **Explication des actions** : fiches pédagogiques par émetteur.

Ces modules servent l'objectif de démocratisation et seront activés après le cœur transactionnel.

---

## 9. Écosystème & API ouverte

L'API est pensée pour l'**écosystème**, pas seulement pour l'app AOTC :

- Accès futur pour **banques**, **fintechs**, **applications tierces**.
- Gouvernée par l'**API Gateway** : auth, versioning, rate limiting, logs, quotas par partenaire.
- Contrats stables (OpenAPI + schémas Zod partagés) pour éviter les ruptures.

---

## 10. Gouvernance & workflows d'approbation

Si plusieurs parties prenantes deviennent actionnaires (Coris, SGI…), certains paramètres sensibles exigent une **validation multi-niveaux** :

| Action sensible | Workflow |
|---|---|
| Modifier une limite de risque / d'exposition | Proposition (admin) → approbation (super admin) |
| Changer `liquidity_mode` ou le capital alloué | Double approbation + audit renforcé |
| Activer le kill-switch marché | Action immédiate + notification gouvernance + justification a posteriori |
| Modifier les spreads globaux | Approbation + traçabilité |

Toutes les actions de gouvernance sont **immuables dans `audit_logs`** et horodatées.

---

## 11. Cas d'exception (à gérer explicitement)

| Cas | Comportement attendu |
|---|---|
| Échec de règlement (T+3) | Alerte Risk Engine, blocage des positions concernées, procédure de résolution |
| Webhook paiement en double | Idempotence via `idempotency_key` → ignoré proprement |
| Retry d'un ordre (réseau) | Idempotence via `client_order_id` → pas de doublon |
| Capital de liquidité épuisé | Pas d'intervention, ordre reste OPEN (jamais d'exécution non couverte) |
| Limite d'exposition atteinte | Refus d'intervention liquidité + alerte |
| Instrument suspendu / marché fermé | Rejet des nouveaux ordres, book gelé |
| KYC invalidé après coup | Suspension du compte, blocage des nouveaux ordres |
| Écart de réconciliation SGI | Alerte + gel ciblé + investigation |
| Panne d'un service | Message Bus tamponne ; reprise après redémarrage (event sourcing rejouable) |

---

## 12. Backups & observabilité (prévus dès le départ)

- **Sauvegardes** : PostgreSQL (PITR), Storage KYC, logs/audit ; restauration testée régulièrement.
- **Monitoring** : Prometheus (métriques), Grafana (dashboards), Sentry (erreurs) — suivi latence, CPU/mémoire, nombre d'ordres, taux d'échec RL/paiements.

---

## 13. Ce qui change par rapport à l'architecture technique initiale

1. `aotc_inventory` (table simple) → **Liquidity Management Engine** (sources de capital + limites multi-niveaux).
2. Ajout explicite du **Smart Order Router** dans le flux d'ordre.
3. **Modèle de données de marché** séparé (officiel vs calculé vs OHLC vs corporate actions).
4. **Message Bus** (Redis Streams) + **Redis cache** au lieu d'appels directs synchrones.
5. **Monitoring Engine** (surveillance de marché) + **AI Engine** (réservé).
6. **API Gateway** + API écosystème (banques/fintechs).
7. **Workflows d'approbation** de gouvernance.
8. **Éducation / simulateur** ajoutés à la vision produit.
9. Mode de liquidité figé sur **`SGI_PARTNER`** pour le MVP.

---

## 14. Prochaine étape

Après validation de ce document, développement du **Lot 1** :

1. Monorepo (pnpm + Turborepo), design system, Supabase, schéma DB + RLS + seeds.
2. Auth + MFA, rôles, RLS multi-tenant SGI.
3. Squelette des 4 moteurs + Message Bus (Redis Streams) + Redis cache.
4. Market Data (simulateur BRVM) + charts.
5. Parcours démontrable : `inscription → KYC → dépôt simulé → premier ordre` en mode `SGI_PARTNER`.
