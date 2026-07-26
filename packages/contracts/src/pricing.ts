import { z } from "zod";
import { SideSchema } from "./orders.js";

export const QuoteRequestedSchema = z.object({
  asset_id: z.string(),
  instrument_id: z.string().optional(),
  side: SideSchema,
  qty: z.number().int().positive(),
  purpose: z.enum(["liquidity_intervention", "indicative", "display"]),
});
export type QuoteRequested = z.infer<typeof QuoteRequestedSchema>;

export const QuoteProvidedSchema = z.object({
  asset_id: z.string(),
  instrument_id: z.string().optional(),
  reference_price: z.number().int(),
  spread_bps: z.number().int(),
  price: z.number().int(),
  side: SideSchema,
  factors: z.object({
    liquidity_factor: z.number(),
    volatility_factor: z.number(),
    risk_factor: z.number(),
    session_factor: z.number(),
  }),
  valid_until: z.string().datetime(),
});
export type QuoteProvided = z.infer<typeof QuoteProvidedSchema>;
