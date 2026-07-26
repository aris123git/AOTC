import { describe, expect, it } from "vitest";
import {
  asAssetId,
  asExchangeId,
  asInstrumentId,
  asMarketId,
  marketPartition,
  NoOpDecisionEngine,
} from "../index.js";
import type { Asset, Exchange, Instrument, Market } from "../index.js";

describe("@aotc/core domain multibourse", () => {
  it("modélise Exchange → Market → Instrument → Asset sans logique BRVM", () => {
    const exchange: Exchange = {
      id: asExchangeId("ex_brvm"),
      code: "BRVM",
      name: "Bourse Régionale des Valeurs Mobilières",
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

    const asset: Asset = {
      id: asAssetId("ast_snts"),
      symbol: "SNTS",
      asset_class: "equity",
      name: "Sonatel",
      currency: "XOF",
      status: "listed",
      tick_size: 5,
      lot_size: 1,
      equity: { sector: "telecom" },
    };

    const instrument: Instrument = {
      id: asInstrumentId("ins_snts_brvm"),
      asset_id: asset.id,
      exchange_id: exchange.id,
      market_id: market.id,
      local_symbol: "SNTS",
      tick_size: 5,
      lot_size: 1,
      status: "tradable",
    };

    expect(instrument.exchange_id).toBe(exchange.id);
    expect(marketPartition(exchange.id, market.id)).toBe("ex_brvm:mkt_equity");
  });

  it("Decision Engine no-op retourne une liste vide", async () => {
    const engine = new NoOpDecisionEngine();
    await engine.observe("TradeExecuted", { trade_id: "t1" });
    const signals = await engine.evaluate({});
    expect(signals).toEqual([]);
  });
});
