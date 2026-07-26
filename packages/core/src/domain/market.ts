import type { ExchangeId, MarketId } from "./ids.js";

/**
 * Segment d'une place (actions, obligations, …).
 * Multibourse : un Market appartient toujours à un Exchange.
 */
export interface Market {
  id: MarketId;
  exchange_id: ExchangeId;
  code: string;
  name: string;
  /** Segment : equity, fixed_income, mixed, … */
  segment: string;
  status: "open" | "closed" | "halted";
}
