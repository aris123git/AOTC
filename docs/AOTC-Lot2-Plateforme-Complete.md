# AOTC Lot 2 — Plateforme complète (sandbox)

Lot 2 étend la sandbox Lot 1 avec **persistance SQLite**, **auth MFA**, moteurs avancés, gouvernance, intents de paiement + webhooks, ticks marché live simulés, et une API partenaire (`/api/v1/*`).

## Périmètre

| Domaine | Contenu Lot 2 |
|---|---|
| Persist | `@aotc/persist` — SQLite via Node 22 `node:sqlite` (`DatabaseSync`) |
| Auth | `@aotc/auth` — OTP 6 chiffres, TOTP (RFC 6238), clés API `aotc_sk_...` |
| Decision | `RuleBasedDecisionEngine` (volume → anomaly, spread, liquidity forecast) |
| Monitoring | unusual_volume, wash_trading, layering, spoofing (annulation rapide) |
| Pricing | Spread dynamique 30–120 bps (session / qty / facteurs) |
| Treasury | Snapshot : available, immobilized, credit lines, capital_by_source |
| Liquidity | `setMode('SGI_PARTNER' \| 'AOTC_PRINCIPAL')` |
| Market data | Simulateur random-walk + `getTicks()` |
| Platform | OTP/MFA, payment intents + webhooks, gouvernance, API keys, multi-user léger |
| API | Routes journal étendues + OpenAPI minimal `/api/openapi.json` |

## Simulé vs réel

**Toujours simulé (sandbox)** :

- Dépôts / retraits Mobile Money (intents + webhook `signature=sandbox` ou HMAC `aotc_sandbox_whsec`)
- Contreparties SGI / inventaire liquidité AOTC
- Ticks marché (pas de flux BRVM officiel)
- Settlement T+3 (confirmation manuelle)
- OTP : le `dev_code` est renvoyé dans la réponse API (jamais en production)

**Réel côté technique sandbox** :

- Persistance fichier SQLite (`AOTC_DB_PATH` ou `.data/aotc.sqlite`)
- TOTP HMAC-SHA1 conforme RFC 6238
- Hash SHA-256 des clés API

Hors scope : PSP réel, Redis/NATS, agrément CREPMF, connecteurs BRVM/SGI production.

## Architecture (rappel)

Les **engines n'importent jamais** d'autres engines ni de client DB.  
La persistance et l'orchestration vivent dans `packages/persist` + `packages/sandbox-platform` (adaptateurs hors moteurs).

## Lancer

```bash
corepack prepare pnpm@9.15.0 --activate
pnpm install
pnpm build
pnpm test

# App
pnpm --filter @aotc/journal-ui start
# → http://localhost:8787
```

Variables utiles :

- `PORT` — défaut `8787`
- `AOTC_DB_PATH` — chemin SQLite (défaut `.data/aotc.sqlite`)

## Parcours auth / paiement (exemples)

```bash
# OTP
curl -s -X POST localhost:8787/api/auth/otp/request -H 'content-type: application/json' \
  -d '{"email":"awa@example.com"}'
# → { "dev_code": "123456", ... }

curl -s -X POST localhost:8787/api/auth/otp/verify -H 'content-type: application/json' \
  -d '{"email":"awa@example.com","code":"123456"}'
# → session_token (header optionnel X-AOTC-Session)

# Intent + webhook
curl -s -X POST localhost:8787/api/payments/intent -H 'content-type: application/json' \
  -d '{"amount":1000000,"kind":"deposit"}'
curl -s -X POST localhost:8787/api/payments/webhook -H 'content-type: application/json' \
  -d '{"intent_id":"<id>","signature":"sandbox"}'
```

## API partenaire

1. `POST /api/partner/keys` → récupérer `raw_key`
2. Appeler `GET /api/v1/market` avec `Authorization: Bearer aotc_sk_...`
3. Spec : `GET /api/openapi.json`

## Compatibilité Lot 1

Les tests Lot 1 (scénario E2E journal, parcours signup→trade sandbox) restent verts.  
`createPlatform()` sans `dbPath` conserve le comportement mémoire ; la persistance s'active avec `{ dbPath }` ou via le serveur journal.
