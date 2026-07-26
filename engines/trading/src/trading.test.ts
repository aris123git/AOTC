import { describe, expect, it } from "vitest";
import { asInstrumentId } from "@aotc/core";
import { InMemoryLeaderElection, InMemoryMessageBus } from "@aotc/message-bus";
import { TOPICS, createEnvelope } from "@aotc/contracts";
import { InMemoryOrderBookRepository, TradingEngine } from "../src/index.js";

describe("TradingEngine", () => {
  it("repose un ordre via repository + publie OrderRested (pas d'accès DB)", async () => {
    const bus = new InMemoryMessageBus();
    const leadership = new InMemoryLeaderElection();
    const orderBook = new InMemoryOrderBookRepository();
    const engine = new TradingEngine({ orderBook });

    await engine.start({
      bus,
      leadership,
      replica_id: "trading-1",
      environment: "sandbox",
    });

    const correlation_id = "33333333-3333-3333-3333-333333333333";
    await bus.publish(
      TOPICS.ORDERS_ACCEPTED,
      createEnvelope({
        type: "OrderAccepted",
        correlation_id,
        environment: "sandbox",
        payload: {
          client_order_id: "co-1",
          order_id: "ord-1",
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
          price_limit: 15000,
          reservation_ref: "res-1",
          route: "internal_book",
        },
      }),
    );

    // laisser le handler async se terminer
    await new Promise((r) => setTimeout(r, 10));

    const snap = await orderBook.getSnapshot(asInstrumentId("ins_snts"));
    expect(snap.bids.some((l) => l.order_ids.includes("ord-1"))).toBe(true);
    expect(bus.dump(TOPICS.TRADING_RESTED).length).toBeGreaterThanOrEqual(1);
    expect(engine.replicaState().role).toBe("leader");

    await engine.stop();
  });
});
