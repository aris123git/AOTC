import { describe, expect, it, beforeEach } from "vitest";
import { createPlatform, type SandboxPlatform } from "./index.js";

describe("SandboxPlatform", () => {
  let platform: SandboxPlatform;

  beforeEach(async () => {
    platform = createPlatform();
    await platform.start();
  });

  it("expose 5 actions sur le marché DEMO", () => {
    const market = platform.listMarket();
    expect(market).toHaveLength(5);
    expect(market.map((m) => m.symbol).sort()).toEqual([
      "BOAB",
      "ORAG",
      "SGBC",
      "SNTS",
      "TTLC",
    ]);
  });

  it("parcours signup → kyc → dépôt → achat SNTS → holdings", async () => {
    await platform.signup({ name: "Awa Diallo", email: "awa@example.com" });
    await platform.submitKyc();
    await platform.deposit(10_000_000);

    const result = await platform.placeOrder({
      symbol: "SNTS",
      side: "buy",
      order_type: "market",
      qty: 10,
    });

    expect(result.rejected).toBe(false);
    expect(result.order.qty_filled).toBe(10);
    expect(result.fills.length).toBeGreaterThanOrEqual(1);

    const portfolio = platform.getPortfolio();
    const snts = portfolio.holdings.find((h) => h.symbol === "SNTS");
    expect(snts?.qty).toBe(10);
    expect(portfolio.cash_available).toBeLessThan(10_000_000);
  });

  it("vente sans contrepartie → intervention liquidité", async () => {
    await platform.signup({ name: "Ibrahim", email: "ib@example.com" });
    await platform.submitKyc();
    await platform.deposit(50_000_000);

    // Acquérir des titres via le book MM
    await platform.placeOrder({
      symbol: "SNTS",
      side: "buy",
      order_type: "market",
      qty: 50,
    });

    // Vente limite au-dessus du bid MM → pas de match carnet → liquidité
    const sell = await platform.placeOrder({
      symbol: "SNTS",
      side: "sell",
      order_type: "limit",
      qty: 20,
      price_limit: 15_000,
    });

    expect(sell.rejected).toBe(false);
    expect(sell.fills.some((f) => f.aotc_as_principal)).toBe(true);
    expect(sell.order.qty_filled).toBe(20);

    const portfolio = platform.getPortfolio();
    const snts = portfolio.holdings.find((h) => h.symbol === "SNTS");
    expect(snts?.qty).toBe(30);
  });

  it("rejette un achat si fonds insuffisants", async () => {
    await platform.signup({ name: "Fatou", email: "fatou@example.com" });
    await platform.submitKyc();
    await platform.deposit(1_000); // trop peu pour 1 SNTS ~15k

    const result = await platform.placeOrder({
      symbol: "SNTS",
      side: "buy",
      order_type: "limit",
      qty: 1,
      price_limit: 15_000,
    });

    expect(result.rejected).toBe(true);
    expect(result.order.rejection_reasons).toContain("insufficient_funds");
  });
});
