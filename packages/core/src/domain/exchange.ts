import type { ExchangeId } from "./ids.js";

/**
 * Place de cotation (multibourse).
 * Aucune logique spécifique BRVM / BVMAC / NGX / JSE ici :
 * les particularités sont des données de configuration.
 */
export interface Exchange {
  id: ExchangeId;
  /** Code stable, ex: "BRVM", "BVMAC", "NGX", "JSE" */
  code: string;
  name: string;
  /** Devise de cotation principale (ISO 4217). MVP : XOF pour BRVM. */
  currency: string;
  timezone: string;
  status: "active" | "inactive";
  /** Horaires / calendrier : configuration, pas de code métier branché. */
  config: ExchangeConfig;
}

export interface ExchangeConfig {
  /** Ouverture/fermeture exprimées en HH:mm local à `timezone`. */
  session_open: string;
  session_close: string;
  /** Jours de semaine ouverts (0=dim … 6=sam). */
  trading_days: number[];
  settlement_cycle_days: number;
}
