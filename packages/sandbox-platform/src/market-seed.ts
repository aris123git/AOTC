import {
  asAssetId,
  asExchangeId,
  asInstrumentId,
  asMarketId,
  type Asset,
  type Exchange,
  type Instrument,
  type Market,
} from "@aotc/core";
import type { CandleDto } from "./types.js";

export type SeededEquity = {
  asset: Asset;
  instrument: Instrument;
  reference_price: number;
  sector: string;
  candles: CandleDto[];
};

export type MarketSeed = {
  exchange: Exchange;
  market: Market;
  equities: SeededEquity[];
};

const EQUITY_DEFS = [
  {
    symbol: "SNTS",
    name: "Sonatel",
    sector: "telecom",
    reference_price: 15_000,
    asset_id: "ast_snts",
    instrument_id: "ins_snts",
  },
  {
    symbol: "ORAG",
    name: "Orange CI",
    sector: "telecom",
    reference_price: 12_000,
    asset_id: "ast_orag",
    instrument_id: "ins_orag",
  },
  {
    symbol: "SGBC",
    name: "SGBC",
    sector: "bank",
    reference_price: 85_000,
    asset_id: "ast_sgbc",
    instrument_id: "ins_sgbc",
  },
  {
    symbol: "BOAB",
    name: "BOA",
    sector: "bank",
    reference_price: 4_200,
    asset_id: "ast_boab",
    instrument_id: "ins_boab",
  },
  {
    symbol: "TTLC",
    name: "TotalEnergies",
    sector: "energy",
    reference_price: 2_800,
    asset_id: "ast_ttlc",
    instrument_id: "ins_ttlc",
  },
] as const;

export const LIQUIDITY_SEED_QTY = 5_000;
export const MM_USER_ID = "mm_demo";
export const MM_SGI_ID = "sgi_mm_demo";
export const DEFAULT_SGI_ID = "sgi_demo";

/** Génère 20 points OHLC autour du prix de référence. */
export function buildSparkline(reference: number, points = 20): CandleDto[] {
  const candles: CandleDto[] = [];
  let px = reference;
  const now = Date.now();
  for (let i = points - 1; i >= 0; i--) {
    const drift = Math.round(reference * 0.002 * Math.sin(i * 0.7));
    const open = px;
    const close = Math.max(1, open + drift + ((i % 3) - 1) * 5);
    const high = Math.max(open, close) + 10;
    const low = Math.max(1, Math.min(open, close) - 10);
    candles.push({
      ts: new Date(now - i * 86_400_000).toISOString(),
      open,
      high,
      low,
      close,
      volume: 1_000 + i * 37,
    });
    px = close;
  }
  // Aligner le dernier close sur le prix de référence
  const last = candles[candles.length - 1];
  if (last) {
    last.close = reference;
    last.high = Math.max(last.high, reference);
    last.low = Math.min(last.low, reference);
  }
  return candles;
}

export function createMarketSeed(): MarketSeed {
  const exchange: Exchange = {
    id: asExchangeId("ex_demo"),
    code: "DEMO",
    name: "Exchange de démonstration",
    currency: "XOF",
    timezone: "Africa/Abidjan",
    status: "active",
    config: {
      session_open: "09:00",
      session_close: "15:30",
      trading_days: [1, 2, 3, 4, 5],
      settlement_cycle_days: 3,
    },
  };

  const market: Market = {
    id: asMarketId("mkt_equity"),
    exchange_id: exchange.id,
    code: "EQUITY",
    name: "Marché Actions",
    segment: "equity",
    status: "open",
  };

  const equities: SeededEquity[] = EQUITY_DEFS.map((d) => {
    const asset: Asset = {
      id: asAssetId(d.asset_id),
      symbol: d.symbol,
      asset_class: "equity",
      name: d.name,
      currency: "XOF",
      status: "listed",
      tick_size: 5,
      lot_size: 1,
      equity: { sector: d.sector },
    };
    const instrument: Instrument = {
      id: asInstrumentId(d.instrument_id),
      asset_id: asset.id,
      exchange_id: exchange.id,
      market_id: market.id,
      local_symbol: d.symbol,
      tick_size: 5,
      lot_size: 1,
      status: "tradable",
    };
    return {
      asset,
      instrument,
      reference_price: d.reference_price,
      sector: d.sector,
      candles: buildSparkline(d.reference_price),
    };
  });

  return { exchange, market, equities };
}
