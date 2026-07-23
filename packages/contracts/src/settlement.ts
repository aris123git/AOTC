import { z } from "zod";

export const SettlementInstructedSchema = z.object({
  settlement_id: z.string(),
  trade_id: z.string(),
  asset_id: z.string(),
  instrument_id: z.string().optional(),
  qty: z.number().int().positive(),
  amount: z.number().int().nonnegative(),
  buyer_sgi_id: z.string(),
  seller_sgi_id: z.string(),
  settlement_date: z.string(),
  status: z.literal("instructed"),
});
export type SettlementInstructed = z.infer<typeof SettlementInstructedSchema>;

export const SettlementConfirmedSchema = z.object({
  settlement_id: z.string(),
  confirmed_at: z.string().datetime(),
});
export type SettlementConfirmed = z.infer<typeof SettlementConfirmedSchema>;

export const SettlementFailedSchema = z.object({
  settlement_id: z.string(),
  reason: z.enum([
    "counterparty_default",
    "reconciliation_mismatch",
    "sgi_timeout",
    "other",
  ]),
  detail: z.string().optional(),
});
export type SettlementFailed = z.infer<typeof SettlementFailedSchema>;
