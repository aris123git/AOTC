import { z } from "zod";

export const PartnerStatsUpdatedSchema = z.object({
  sgi_id: z.string(),
  period: z.string(),
  volume_brought: z.number().int().nonnegative(),
  revenue_generated: z.number().int().nonnegative(),
  commissions: z.number().int().nonnegative(),
  market_share_bps: z.number().int().nonnegative(),
  performance: z.object({
    fill_rate: z.number(),
    avg_execution_ms: z.number(),
  }),
  updated_at: z.string().datetime(),
});
export type PartnerStatsUpdated = z.infer<typeof PartnerStatsUpdatedSchema>;
