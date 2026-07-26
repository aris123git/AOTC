/**
 * Decision Engine — RÈGLE #6.
 * Interface figée dès le jour 1 ; implémentation MVP = no-op.
 * Futures capacités : IA, recommandations, prévision liquidité,
 * détection d'anomalies, optimisation des spreads.
 */

export type DecisionSignalKind =
  | "recommendation"
  | "liquidity_forecast"
  | "anomaly"
  | "spread_optimization"
  | "other";

export interface DecisionSignal {
  signal_id: string;
  kind: DecisionSignalKind;
  /** Cible optionnelle (asset / instrument / sgi / user). */
  subject?: {
    asset_id?: string;
    instrument_id?: string;
    sgi_id?: string;
    user_id?: string;
  };
  score?: number;
  payload: Record<string, unknown>;
  produced_at: string;
  /** Toujours false au MVP (moteur vide). */
  actionable: boolean;
}

/**
 * Port Decision Engine.
 * Les autres moteurs ne connaissent pas l'implémentation (IA ou règles).
 */
export interface DecisionEnginePort {
  /** Consomme un événement du bus (lecture seule, side-effect interne). */
  observe(eventType: string, payload: unknown): Promise<void>;
  /** Produit des signaux (vide au MVP). */
  evaluate(context: Record<string, unknown>): Promise<DecisionSignal[]>;
}

/** Implémentation no-op livrée avec le core — remplacée plus tard sans changer l'interface. */
export class NoOpDecisionEngine implements DecisionEnginePort {
  async observe(_eventType: string, _payload: unknown): Promise<void> {
    /* intentionally empty */
  }

  async evaluate(_context: Record<string, unknown>): Promise<DecisionSignal[]> {
    return [];
  }
}
