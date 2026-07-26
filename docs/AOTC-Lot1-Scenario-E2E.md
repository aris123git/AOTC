# AOTC — Lot 1 : Scénario de bout en bout

> **Statut :** périmètre figé pour le Lot 1.
> Objectif : **un seul scénario complet**, pas toute la plateforme.
> Si cette démo fonctionne, l'architecture est prouvée viable.

---

## 1. Le scénario unique (12 étapes)

À la fin du Lot 1, on doit pouvoir exécuter exactement ceci :

| # | Étape | Composant |
|---|---|---|
| 1 | Un investisseur crée son compte | Auth |
| 2 | Il effectue son KYC | KYC |
| 3 | Une SGI valide son KYC | KYC / SGI |
| 4 | Il effectue un dépôt simulé | Payments (simulé) |
| 5 | Il consulte les actions disponibles | Market Data (simulé) |
| 6 | Il passe un ordre d'achat | Order API |
| 7 | Le Risk Engine valide | Risk Engine |
| 8 | Le Smart Order Router choisit la destination | SOR |
| 9 | Le Trading Engine reçoit l'ordre | Trading Engine |
| 10 | Le carnet d'ordres est mis à jour | OrderBook (via repository) |
| 11 | Le portefeuille est mis à jour | Ledger / Holdings |
| 12 | Toutes les opérations apparaissent dans les journaux d'audit | Audit + **Simulation Journal** |

Mode : `SGI_PARTNER` · `environment = sandbox`.

---

## 2. Critère de succès

Une chronologie lisible (Simulation Journal) du type :

```
09:41:12  Ordre reçu
09:41:12  Risk Engine : VALIDÉ
09:41:13  Smart Order Router : Book interne
09:41:13  Trading Engine : Ordre reposé / Match
09:41:13  Liquidity Engine : (si besoin) Intervention approuvée
09:41:14  Settlement Engine : Instruction T+3 créée
09:41:14  Portefeuille mis à jour
```

Cette vue sert au débogage **et** aux démonstrations partenaires (SGI, investisseurs institutionnels).

---

## 3. Hors périmètre Lot 1 (interfaces prévues, implémentation désactivée / simulée)

| Capacité | Statut Lot 1 |
|---|---|
| Decision Engine / AI | Interface + no-op |
| Monitoring avancé (wash/spoofing/…) | Stub consumer |
| Treasury complet | Réservation simulée minimale |
| Partner Management avancé | Stub agrégation |
| Pricing dynamique | Spread fixe simulé |
| API publique écosystème | Non |
| Mobile Money réel | Webhook / dépôt **simulé** |
| Connexion SGI réelle | Validation KYC **simulée** / in-app |
| Flux BRVM réel | Market data **simulée** |

Ils peuvent renvoyer des données simulées ; ils ne bloquent pas le scénario.

---

## 4. Discipline PR (stricte)

**Une Pull Request = un moteur ou une fonctionnalité métier complète.**

| PR | Contenu |
|---|---|
| *(fondations)* | Principes immutables + monorepo + contrats + squelettes |
| **Celle-ci** | Périmètre Lot 1 + **Simulation Journal** |
| Auth + MFA | Compte investisseur, OTP/MFA |
| KYC | Upload + validation SGI |
| Market Data | Catalogue instruments + ticks simulés |
| Dépôt simulé | Crédit cash sandbox |
| Risk Engine | Contrôles pré-trade réels du scénario |
| Smart Order Router | Choix destination (book interne MVP) |
| Trading Engine | Matching / carnet |
| Settlement Engine | Instruction T+3 |
| Liquidity Engine | Intervention si pas de contrepartie |
| Portefeuille + Audit | Holdings + audit_logs persistés |

Pas de « mega-PR » qui touche 5 moteurs à la fois.

---

## 5. Règles d'architecture (rappel)

Voir [Principes Immutables](./AOTC-Principes-Architecture-Immutables.md) :

- Moteurs → bus + contrats + ports uniquement
- Aucun couplage direct entre moteurs
- `packages/core` sans infra
- Multibourse (`Exchange` / `Market` / `Instrument` / `Asset`)
- Leadership par partition
- Decision Engine interface-only

Toute évolution hors de ce cadre → **nouvelle proposition d'architecture**.
