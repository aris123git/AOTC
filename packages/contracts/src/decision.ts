import { z } from "zod";

/** Signaux Decision Engine (Règle #6) — topic aotc.decision.signal */
export const DecisionSignalSchema = z.object({
  signal_id: z.string(),
  kind: z.enum([
    "recommendation",
    "liquidity_forecast",
    "anomaly",
    "spread_optimization",
    "other",
  ]),
  subject: z
    .object({
      asset_id: z.string().optional(),
      instrument_id: z.string().optional(),
      sgi_id: z.string().optional(),
      user_id: z.string().optional(),
    })
    .optional(),
  score: z.number().optional(),
  payload: z.record(z.unknown()),
  produced_at: z.string().datetime(),
  actionable: z.boolean(),
});
export type DecisionSignal = z.infer<typeof DecisionSignalSchema>;
