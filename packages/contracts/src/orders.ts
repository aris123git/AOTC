import { z } from "zod";

export const SideSchema = z.enum(["buy", "sell"]);
export const OrderTypeSchema = z.enum(["market", "limit"]);
export const TifSchema = z.enum(["gtc", "day", "ioc", "fok"]);

export const OrderRequestedSchema = z.object({
  client_order_id: z.string(),
  user_id: z.string(),
  sgi_id: z.string(),
  asset_id: z.string(),
  /** Multibourse : instrument coté (préféré à asset seul pour le matching). */
  instrument_id: z.string().optional(),
  exchange_id: z.string().optional(),
  market_id: z.string().optional(),
  side: SideSchema,
  order_type: OrderTypeSchema,
  tif: TifSchema,
  qty: z.number().int().positive(),
  price_limit: z.number().int().positive().optional(),
});
export type OrderRequested = z.infer<typeof OrderRequestedSchema>;

export const RiskDecisionSchema = z.object({
  client_order_id: z.string(),
  approved: z.boolean(),
  reasons: z.array(z.string()),
  checks: z.object({
    kyc_ok: z.boolean(),
    market_open: z.boolean(),
    asset_tradable: z.boolean(),
    funds_or_holdings_ok: z.boolean(),
    within_limits: z.boolean(),
  }),
  reservation_ref: z.string().optional(),
});
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export const RoutingDecisionSchema = z.object({
  client_order_id: z.string(),
  route: z.enum([
    "internal_book",
    "sgi_counterparty",
    "aotc_liquidity",
    "external_venue",
  ]),
  venue_ref: z.string().optional(),
  rationale: z.object({
    criteria: z.array(
      z.enum([
        "best_price",
        "speed",
        "available_liquidity",
        "cost",
        "best_execution_policy",
      ]),
    ),
    reference_price: z.number().int(),
    expected_price: z.number().int().optional(),
  }),
});
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

export const OrderAcceptedSchema = z.object({
  client_order_id: z.string(),
  order_id: z.string(),
  user_id: z.string(),
  sgi_id: z.string(),
  asset_id: z.string(),
  instrument_id: z.string(),
  exchange_id: z.string(),
  market_id: z.string(),
  side: SideSchema,
  order_type: OrderTypeSchema,
  tif: TifSchema,
  qty: z.number().int().positive(),
  price_limit: z.number().int().positive().optional(),
  reservation_ref: z.string(),
  route: RoutingDecisionSchema.shape.route,
  venue_ref: z.string().optional(),
});
export type OrderAccepted = z.infer<typeof OrderAcceptedSchema>;
