import { z } from "zod";

export const PriceTickSchema = z.object({
  asset_id: z.string(),
  instrument_id: z.string().optional(),
  exchange_id: z.string().optional(),
  last: z.number().int(),
  mid: z.number().int(),
  ts: z.string().datetime(),
  /** Source générique : officielle place vs calculée AOTC (pas de hardcode BRVM). */
  source: z.enum(["exchange_official", "aotc_computed"]),
});
export type PriceTick = z.infer<typeof PriceTickSchema>;

export const BookSnapshotSchema = z.object({
  instrument_id: z.string(),
  bids: z.array(z.object({ price: z.number().int(), qty: z.number().int() })),
  asks: z.array(z.object({ price: z.number().int(), qty: z.number().int() })),
  ts: z.string().datetime(),
});
export type BookSnapshot = z.infer<typeof BookSnapshotSchema>;

export const CandleSchema = z.object({
  asset_id: z.string(),
  instrument_id: z.string().optional(),
  tf: z.enum(["1m", "1h", "1d"]),
  o: z.number().int(),
  h: z.number().int(),
  l: z.number().int(),
  c: z.number().int(),
  v: z.number().int(),
  ts: z.string().datetime(),
});
export type Candle = z.infer<typeof CandleSchema>;

export const CorporateActionSchema = z.object({
  asset_id: z.string(),
  kind: z.enum(["dividend", "split", "rights_issue", "coupon", "redemption"]),
  ex_date: z.string(),
  details: z.record(z.unknown()),
});
export type CorporateAction = z.infer<typeof CorporateActionSchema>;
