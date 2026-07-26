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

## Monorepo

```
packages/
  core/                 # Domaine pur + ports
  contracts/            # Schémas Zod figés
  message-bus/          # Bus / leadership in-memory
  simulation-journal/   # Chronologie des décisions
  sandbox-platform/     # Session exchange sandbox (orchestration)
engines/
  trading/ risk/ pricing/ liquidity/ treasury/
  settlement/ sor/ decision/ monitoring/ partner/ market-data/
apps/journal/           # App investisseur + API + NOC
```

## App sandbox (paiements démo)

**Tout est en mode `sandbox`** : dépôt / retrait Mobile Money **simulés**, aucun PSP réel, aucune instruction RL réelle.

Parcours : **compte → KYC → dépôt simulé → marché multi-titres → achat/vente → liquidité → settlement → portefeuille → journal → éducation → NOC / SGI**.

```bash
pnpm install && pnpm build
pnpm --filter @aotc/journal-ui start
# → http://localhost:8787
```

Dev UI (proxy API) :

```bash
pnpm --filter @aotc/journal-ui build   # compile le serveur
pnpm --filter @aotc/journal-ui start   # API :8787
# autre terminal :
pnpm --filter @aotc/journal-ui dev     # Vite :5173 → proxy /api
```

**CLI** (chronologie Lot 1 seule) :

```bash
pnpm --filter @aotc/simulation-journal demo
```

## Ce que la sandbox couvre

- 5 actions DEMO (SNTS, ORAG, SGBC, BOAB, TTLC) + carnet + sparkline
- Ordres market/limit, buy/sell, annulation
- Risk pré-trade (KYC, cash, titres, marché)
- Matching prix/temps + intervention liquidité `SGI_PARTNER` (vente sans acheteur)
- Settlement T+3 (instruire / confirmer)
- Journal d’activité moteurs, stats SGI, NOC + kill-switch
- Modules éducation

Hors scope production : Mobile Money réel, SGI réelle, flux BRVM réel, Redis/NATS, agrément CREPMF.
