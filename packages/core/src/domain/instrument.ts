import type { AssetId, ExchangeId, InstrumentId, MarketId } from "./ids.js";

/**
 * Instrument = cotation tradable d'un Asset sur un Market.
 * Sépare le sous-jacent (Asset) de sa cotation place (Instrument).
 */
export interface Instrument {
  id: InstrumentId;
  asset_id: AssetId;
  exchange_id: ExchangeId;
  market_id: MarketId;
  /** Symbole local à la place (ex: SNTS sur BRVM). */
  local_symbol: string;
  tick_size: number;
  lot_size: number;
  status: "tradable" | "suspended" | "delisted";
}
