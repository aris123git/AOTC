import { describe, expect, it } from "vitest";
import {
  createEnvelope,
  OrderRequestedSchema,
  TOPICS,
  TradeExecutedSchema,
} from "../src/index.js";

describe("@aotc/contracts", () => {
  it("valide OrderRequested", () => {
    const parsed = OrderRequestedSchema.parse({
      client_order_id: "co-1",
      user_id: "u1",
      sgi_id: "sgi1",
      asset_id: "ast_snts",
      instrument_id: "ins_snts",
      exchange_id: "ex_brvm",
      market_id: "mkt_equity",
      side: "buy",
      order_type: "limit",
      tif: "day",
      qty: 100,
      price_limit: 15_000,
    });
    expect(parsed.side).toBe("buy");
  });

  it("crée une enveloppe sandbox avec correlation", () => {
    const env = createEnvelope({
      type: "OrderRequested",
      correlation_id: "11111111-1111-1111-1111-111111111111",
      environment: "sandbox",
      payload: { ok: true },
    });
    expect(env.environment).toBe("sandbox");
    expect(env.schema_version).toBe("1.0");
    expect(TOPICS.TRADING_TRADE).toBe("aotc.trading.trade");
  });

  it("valide TradeExecuted multibourse", () => {
    const trade = TradeExecutedSchema.parse({
      trade_id: "tr1",
      asset_id: "ast_snts",
      instrument_id: "ins_snts",
      exchange_id: "ex_brvm",
      market_id: "mkt_equity",
      buy_order_id: "o1",
      sell_order_id: "o2",
      qty: 10,
      price: 15000,
      buyer_sgi_id: "sgi1",
      seller_sgi_id: "sgi2",
      aotc_as_principal: false,
      liquidity_source: "internal_book",
      executed_at: new Date().toISOString(),
    });
    expect(trade.exchange_id).toBe("ex_brvm");
  });
});
