# AOTC — African OTC Exchange

**Market Infrastructure Platform** pour la liquidité OTC en Afrique de l'Ouest (et au-delà).

## Principes immutables

Avant tout code, six règles d'architecture sont **figées** :

→ [`docs/AOTC-Principes-Architecture-Immutables.md`](./docs/AOTC-Principes-Architecture-Immutables.md)

1. Matching Engine → Message Bus + contrats + repository uniquement (jamais la DB directe)
2. Les moteurs ne se connaissent pas (event-driven)
3. `packages/core` indépendant de Supabase / Next.js / Redis
4. Multibourse dès le jour 1 (`Exchange` → `Market` → `Instrument` → `Asset`)
5. Haute disponibilité : moteurs × N, un leader par partition
6. Decision Engine (interface IA) dès le jour 1, même vide

## Documents de référence

| Document | Rôle |
|---|---|
| [Principes Immutables](./docs/AOTC-Principes-Architecture-Immutables.md) | Règles non négociables |
| [Architecture Fonctionnelle et Métier](./docs/AOTC-Architecture-Fonctionnelle-et-Metier.md) | Flux métier, liquidité, risque |
| [Interfaces & Contrats](./docs/AOTC-Interfaces-Moteurs-et-Contrats-de-Donnees.md) | Schémas inter-moteurs |
| [Lot 1 — Scénario E2E](./docs/AOTC-Lot1-Scenario-E2E.md) | Périmètre unique (12 étapes) + discipline PR |

## Monorepo (Lot 1 — fondations)

```
packages/
  core/                 # Domaine pur + ports (aucune infra)
  contracts/            # Schémas Zod figés
  message-bus/          # Adapters bus / leadership (in-memory → Redis)
  simulation-journal/   # Chronologie lisible des décisions (MVP démo)
engines/
  trading/ risk/ pricing/ liquidity/ treasury/
  settlement/ sor/ decision/ monitoring/ partner/ market-data/
apps/                   # Next.js / API Gateway (à venir)
```

## Démo Lot 1 (journal de simulation)

**UI web**

```bash
pnpm install && pnpm build
pnpm --filter @aotc/journal-ui start
# → http://localhost:8787
# → http://localhost:8787/standalone.html  (page autonome)
```

**CLI**

```bash
pnpm --filter @aotc/simulation-journal demo
```

## Lot 1 — suite (une PR = une feature)

Voir la roadmap dans [`docs/AOTC-Lot1-Scenario-E2E.md`](./docs/AOTC-Lot1-Scenario-E2E.md) :
Auth+MFA → KYC → Market Data → Dépôt simulé → Risk → SOR → Trading → Settlement → Liquidity → Portefeuille/Audit.

Hors scope pour l'instant (interfaces / stubs) : AI, monitoring avancé, treasury complet, partner avancé, pricing dynamique, API publique, Mobile Money réel, SGI réelle, flux BRVM réel.
