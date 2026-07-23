/**
 * Port Simulation Journal — chronologie lisible des décisions moteurs.
 * Les moteurs publient via MessageBus (contrat) ; ce port sert à lire / formater.
 */

import type { Environment } from "./message-bus.js";

export type SimulationJournalActor =
  | "investor"
  | "sgi"
  | "system"
  | "risk"
  | "sor"
  | "trading"
  | "liquidity"
  | "treasury"
  | "settlement"
  | "pricing"
  | "marketdata"
  | "decision"
  | "monitoring"
  | "partner"
  | "auth"
  | "kyc"
  | "payments"
  | "portfolio"
  | "audit";

export type SimulationJournalSeverity = "info" | "success" | "warning" | "error";

export interface SimulationJournalEntry {
  entry_id: string;
  correlation_id: string;
  occurred_at: string;
  actor: SimulationJournalActor;
  summary: string;
  severity: SimulationJournalSeverity;
  scenario_step?: number;
  details?: Record<string, unknown>;
  environment: Environment;
}

export interface AppendJournalInput {
  correlation_id: string;
  actor: SimulationJournalActor;
  summary: string;
  severity?: SimulationJournalSeverity;
  scenario_step?: number;
  details?: Record<string, unknown>;
  environment: Environment;
  occurred_at?: string;
  entry_id?: string;
}

/**
 * Store + lecture du journal pour une correlation (parcours d'ordre / démo).
 * Persistance : adapter mémoire (MVP) → Postgres plus tard, sans changer les moteurs.
 */
export interface SimulationJournalPort {
  append(input: AppendJournalInput): Promise<SimulationJournalEntry>;
  listByCorrelation(correlationId: string): Promise<SimulationJournalEntry[]>;
  /** Format chronologie présentation (HH:mm:ss  résumé). */
  formatTimeline(correlationId: string): Promise<string[]>;
}
