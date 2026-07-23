import { z } from "zod";

export const MarketAbuseAlertSchema = z.object({
  alert_id: z.string(),
  asset_id: z.string().optional(),
  sgi_id: z.string().optional(),
  user_id: z.string().optional(),
  pattern: z.enum([
    "abnormal_price",
    "unusual_volume",
    "wash_trading",
    "spoofing",
    "layering",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  evidence: z.record(z.unknown()),
  detected_at: z.string().datetime(),
});
export type MarketAbuseAlert = z.infer<typeof MarketAbuseAlertSchema>;

export const OpsSnapshotSchema = z.object({
  ts: z.string().datetime(),
  orders_per_min: z.number(),
  failures: z.object({
    rejected_orders: z.number(),
    failed_payments: z.number(),
    failed_settlements: z.number(),
  }),
  pending: z.object({
    payments: z.number(),
    settlements: z.number(),
  }),
  risk_alerts_open: z.number(),
  engines_health: z.record(
    z.enum([
      "trading",
      "liquidity",
      "treasury",
      "settlement",
      "risk",
      "pricing",
      "sor",
      "marketdata",
      "decision",
    ]),
    z.enum(["up", "degraded", "down"]),
  ),
});
export type OpsSnapshot = z.infer<typeof OpsSnapshotSchema>;
