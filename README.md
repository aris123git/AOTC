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

## Monorepo (Lot 1 — fondations)

```
packages/
  core/           # Domaine pur + ports (aucune infra)
  contracts/      # Schémas Zod figés
  message-bus/    # Adapters bus / leadership (in-memory → Redis)
engines/
  trading/        # Matching (repository + bus uniquement)
  risk/
  pricing/
  liquidity/
  treasury/
  settlement/
  sor/
  decision/       # Intelligence (no-op MVP)
  monitoring/
  partner/
  market-data/
apps/             # Next.js / API Gateway (à venir)
```

## Démarrage

```bash
pnpm install
pnpm build
pnpm test
```

## Lot 1 — suite prévue

- Schéma Supabase + RLS multi-tenant SGI
- Auth + MFA
- Adapter Redis Streams
- Market data simulée + parcours `inscription → KYC → dépôt simulé → premier ordre` (`SGI_PARTNER` / `sandbox`)

Toute évolution majeure des frontières moteurs / contrats passe par une **nouvelle proposition d'architecture**.
