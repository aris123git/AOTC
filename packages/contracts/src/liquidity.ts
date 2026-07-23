import { z } from "zod";
import { SideSchema } from "./orders.js";

export const LiquidityInterventionRequestedSchema = z.object({
  asset_id: z.string(),
  instrument_id: z.string().optional(),
  side: SideSchema,
  qty: z.number().int().positive(),
  correlation_id: z.string().uuid(),
});
export type LiquidityInterventionRequested = z.infer<
  typeof LiquidityInterventionRequestedSchema
>;

export const LiquidityDecisionSchema = z.object({
  approved: z.boolean(),
  reasons: z.array(z.string()),
  quote_ref: z.string().optional(),
  exposure_after: z
    .object({
      by_asset: z.number(),
      by_sgi: z.number(),
      by_sector: z.number(),
      global: z.number(),
    })
    .optional(),
  treasury_reservation_ref: z.string().optional(),
  liquidity_mode: z.enum(["SGI_PARTNER", "AOTC_PRINCIPAL"]),
});
export type LiquidityDecision = z.infer<typeof LiquidityDecisionSchema>;
