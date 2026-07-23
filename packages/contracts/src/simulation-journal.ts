import { z } from "zod";

/**
 * Entrée du Journal de Simulation — chronologie lisible des décisions moteurs.
 * MVP : présentation partenaires + debug. Pas un substitut de audit_logs persisté.
 */
export const SimulationJournalActorSchema = z.enum([
  "investor",
  "sgi",
  "system",
  "risk",
  "sor",
  "trading",
  "liquidity",
  "treasury",
  "settlement",
  "pricing",
  "marketdata",
  "decision",
  "monitoring",
  "partner",
  "auth",
  "kyc",
  "payments",
  "portfolio",
  "audit",
]);

export const SimulationJournalSeveritySchema = z.enum([
  "info",
  "success",
  "warning",
  "error",
]);

export const SimulationJournalEntrySchema = z.object({
  entry_id: z.string().uuid(),
  correlation_id: z.string().uuid(),
  /** Horodatage ISO-8601 UTC de la décision / fait. */
  occurred_at: z.string().datetime(),
  actor: SimulationJournalActorSchema,
  /** Libellé court pour la chronologie UI, ex: "Risk Engine : VALIDÉ" */
  summary: z.string().min(1),
  severity: SimulationJournalSeveritySchema.default("info"),
  /** Étape du scénario Lot 1 (1–12), optionnelle hors parcours. */
  scenario_step: z.number().int().min(1).max(12).optional(),
  details: z.record(z.unknown()).optional(),
  environment: z.enum(["sandbox", "production"]),
});

export type SimulationJournalEntry = z.infer<typeof SimulationJournalEntrySchema>;
export type SimulationJournalActor = z.infer<typeof SimulationJournalActorSchema>;
