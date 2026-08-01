import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { totp } from "@aotc/auth";
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

    await platform.placeOrder({
      symbol: "SNTS",
      side: "buy",
      order_type: "market",
      qty: 50,
    });

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
    await platform.deposit(1_000);

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

  it("OTP login sandbox", async () => {
    await platform.signup({ name: "Awa", email: "otp@example.com" });
    const req = await platform.requestOtp("otp@example.com");
    expect(req.dev_code).toMatch(/^\d{6}$/);
    const session = await platform.verifyOtp("otp@example.com", req.dev_code);
    expect(session.session_token.startsWith("aotc_sess_")).toBe(true);
    expect(session.user.email).toBe("otp@example.com");
  });

  it("MFA setup + verify", async () => {
    await platform.signup({ name: "Awa", email: "mfa@example.com" });
    const setup = await platform.setupMfa();
    expect(setup.secret.length).toBeGreaterThan(10);
    expect(setup.otpauth_url).toContain("otpauth://totp/");
    const code = totp(setup.secret);
    const user = await platform.verifyMfa(code);
    expect(user.mfa_enabled).toBe(true);
  });

  it("deposit intent + webhook sandbox", async () => {
    await platform.signup({ name: "Awa", email: "pay@example.com" });
    await platform.submitKyc();
    const intent = await platform.createDepositIntent(2_000_000);
    expect(intent.status).toBe("pending");
    const confirmed = await platform.confirmPaymentWebhook(intent.id, "sandbox");
    expect(confirmed.status).toBe("succeeded");
    expect(platform.getPortfolio().cash_available).toBe(2_000_000);
  });

  it("decision signals after trade", async () => {
    await platform.signup({ name: "Awa", email: "dec@example.com" });
    await platform.submitKyc();
    await platform.deposit(10_000_000);
    await platform.placeOrder({
      symbol: "SNTS",
      side: "buy",
      order_type: "market",
      qty: 10,
    });
    const signals = platform.getDecisionSignals();
    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(signals.some((s) => s.kind === "spread_optimization")).toBe(true);
  });

  it("api key auth", async () => {
    const key = await platform.createPartnerApiKey("demo");
    expect(key.raw_key?.startsWith("aotc_sk_")).toBe(true);
    const auth = platform.authenticateApiKey(key.raw_key!);
    expect(auth?.id).toBe(key.id);
    platform.revokeApiKey(key.id);
    expect(platform.authenticateApiKey(key.raw_key!)).toBeNull();
  });
});

describe("SandboxPlatform persistence", () => {
  let dir: string;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("persist survives recreate with same dbPath", async () => {
    dir = mkdtempSync(join(tmpdir(), "aotc-plat-"));
    const dbPath = join(dir, "aotc.sqlite");

    const a = createPlatform({ dbPath });
    await a.start();
    await a.signup({ name: "Awa", email: "persist@example.com" });
    await a.submitKyc();
    await a.deposit(5_000_000);
    const cash = a.getPortfolio().cash_available;
    expect(cash).toBe(5_000_000);

    const b = createPlatform({ dbPath });
    await b.start();
    const session = b.getSession();
    expect(session.user?.email).toBe("persist@example.com");
    expect(b.getPortfolio().cash_available).toBe(5_000_000);
  });
});
