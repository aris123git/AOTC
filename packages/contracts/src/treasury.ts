import { z } from "zod";

export const CapitalSourceSchema = z.enum(["aotc_own", "coris", "credit_line"]);

export const FundsReservationRequestedSchema = z.object({
  reservation_id: z.string(),
  purpose: z.enum(["order_cash_lock", "liquidity_intervention"]),
  amount: z.number().int().nonnegative(),
  source_hint: CapitalSourceSchema.optional(),
  correlation_id: z.string().uuid(),
});
export type FundsReservationRequested = z.infer<
  typeof FundsReservationRequestedSchema
>;

export const FundsReservedSchema = z.object({
  reservation_id: z.string(),
  approved: z.boolean(),
  source: CapitalSourceSchema,
  available_after: z.number().int().nonnegative(),
  reasons: z.array(z.string()),
});
export type FundsReserved = z.infer<typeof FundsReservedSchema>;

export const FundsReleaseRequestedSchema = z.object({
  reservation_id: z.string(),
  correlation_id: z.string().uuid(),
});
export type FundsReleaseRequested = z.infer<typeof FundsReleaseRequestedSchema>;
