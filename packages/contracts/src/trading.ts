import { z } from "zod";

export const LiquiditySourceSchema = z.enum([
  "internal_book",
  "sgi_counterparty",
  "aotc_liquidity",
  "external_venue",
]);

export const TradeExecutedSchema = z.object({
  trade_id: z.string(),
  asset_id: z.string(),
  instrument_id: z.string(),
  exchange_id: z.string(),
  market_id: z.string(),
  buy_order_id: z.string(),
  sell_order_id: z.string(),
  qty: z.number().int().positive(),
  price: z.number().int().positive(),
  buyer_sgi_id: z.string(),
  seller_sgi_id: z.string(),
  aotc_as_principal: z.boolean(),
  liquidity_source: LiquiditySourceSchema,
  executed_at: z.string().datetime(),
});
export type TradeExecuted = z.infer<typeof TradeExecutedSchema>;

export const OrderRestedSchema = z.object({
  order_id: z.string(),
  instrument_id: z.string(),
  side: z.enum(["buy", "sell"]),
  price: z.number().int(),
  qty_remaining: z.number().int().nonnegative(),
  rested_at: z.string().datetime(),
});
export type OrderRested = z.infer<typeof OrderRestedSchema>;

export const OrderMatchedSchema = z.object({
  order_id: z.string(),
  trade_id: z.string(),
  qty_filled: z.number().int().positive(),
  qty_remaining: z.number().int().nonnegative(),
  status: z.enum(["partial", "filled"]),
  matched_at: z.string().datetime(),
});
export type OrderMatched = z.infer<typeof OrderMatchedSchema>;
