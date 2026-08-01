import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runLot1Demo } from "@aotc/simulation-journal";
import { createPlatform } from "@aotc/sandbox-platform";
import { openApiDocument } from "./openapi.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(express.json());

const platform = createPlatform({
  dbPath: process.env.AOTC_DB_PATH ?? ".data/aotc.sqlite",
});
await platform.start();

function handleError(res: express.Response, err: unknown): void {
  const message = err instanceof Error ? err.message : "error";
  const status =
    message === "not_authenticated" ||
    message === "invalid_otp" ||
    message === "invalid_mfa" ||
    message === "invalid_webhook_signature"
      ? 401
      : message === "unknown_symbol" ||
          message === "order_not_found" ||
          message === "intent_not_found" ||
          message === "proposal_not_found" ||
          message === "api_key_not_found" ||
          message === "user_not_found"
        ? 404
        : message.startsWith("invalid_") ||
            message === "insufficient_cash" ||
            message === "order_not_cancellable" ||
            message === "mfa_not_setup" ||
            message === "proposal_not_pending"
          ? 400
          : 500;
  res.status(status).json({ error: message });
}

function applySession(req: express.Request): void {
  const token = req.header("x-aotc-session");
  if (token) platform.useSession(token);
}

function requirePartner(req: express.Request, res: express.Response): boolean {
  const header = req.header("authorization") ?? "";
  const raw = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!raw || !platform.authenticateApiKey(raw)) {
    res.status(401).json({ error: "unauthorized" });
    return false;
  }
  return true;
}

app.post("/api/session/reset", async (_req, res) => {
  try {
    await platform.reset();
    res.json(platform.getSession());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/session", (req, res) => {
  applySession(req);
  res.json(platform.getSession());
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { name, email } = req.body ?? {};
    if (typeof name !== "string" || typeof email !== "string") {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    const user = await platform.signup({ name, email });
    res.json(user);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/auth/otp/request", async (req, res) => {
  try {
    const email = String(req.body?.email ?? "");
    if (!email.includes("@")) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    res.json(await platform.requestOtp(email));
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/auth/otp/verify", async (req, res) => {
  try {
    const email = String(req.body?.email ?? "");
    const code = String(req.body?.code ?? "");
    res.json(await platform.verifyOtp(email, code));
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/auth/mfa/setup", async (req, res) => {
  try {
    applySession(req);
    res.json(await platform.setupMfa());
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/auth/mfa/verify", async (req, res) => {
  try {
    applySession(req);
    const code = String(req.body?.code ?? "");
    res.json(await platform.verifyMfa(code));
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/kyc/submit", async (req, res) => {
  try {
    applySession(req);
    const user = await platform.submitKyc();
    res.json(user);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/payments/deposit", async (req, res) => {
  try {
    applySession(req);
    const amount = Number(req.body?.amount);
    const portfolio = await platform.deposit(amount);
    res.json(portfolio);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/payments/withdraw", async (req, res) => {
  try {
    applySession(req);
    const amount = Number(req.body?.amount);
    const portfolio = await platform.withdraw(amount);
    res.json(portfolio);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/payments/intent", async (req, res) => {
  try {
    applySession(req);
    const amount = Number(req.body?.amount);
    const kind =
      req.body?.kind === "withdraw" ? ("withdraw" as const) : ("deposit" as const);
    res.json(await platform.createDepositIntent(amount, kind));
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/payments/webhook", async (req, res) => {
  try {
    const intent_id = String(req.body?.intent_id ?? "");
    const signature = String(req.body?.signature ?? "");
    res.json(await platform.confirmPaymentWebhook(intent_id, signature));
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/treasury", (_req, res) => {
  try {
    res.json(platform.getTreasurySnapshot());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/decision/signals", (_req, res) => {
  try {
    res.json(platform.getDecisionSignals());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/governance", (_req, res) => {
  try {
    res.json(platform.getGovernance());
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/governance/propose", async (req, res) => {
  try {
    const action = String(req.body?.action ?? "");
    const payload =
      typeof req.body?.payload === "object" && req.body.payload
        ? (req.body.payload as Record<string, unknown>)
        : {};
    if (!action) {
      res.status(400).json({ error: "invalid_body" });
      return;
    }
    res.json(await platform.propose(action, payload));
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/governance/:id/approve", async (req, res) => {
  try {
    const actor =
      typeof req.body?.actor === "string" ? req.body.actor : "admin";
    res.json(await platform.approve(req.params.id, actor));
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/admin/liquidity-mode", async (req, res) => {
  try {
    const mode = req.body?.mode;
    if (mode !== "SGI_PARTNER" && mode !== "AOTC_PRINCIPAL") {
      res.status(400).json({ error: "invalid_mode" });
      return;
    }
    res.json(await platform.setLiquidityMode(mode));
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/market/ticks", (_req, res) => {
  try {
    res.json(platform.getTicks());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/partner/keys", (_req, res) => {
  try {
    res.json(platform.listApiKeys());
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/partner/keys", async (req, res) => {
  try {
    const name = String(req.body?.name ?? "partner");
    res.json(await platform.createPartnerApiKey(name));
  } catch (err) {
    handleError(res, err);
  }
});

app.delete("/api/partner/keys/:id", (req, res) => {
  try {
    res.json(platform.revokeApiKey(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/sgi/clients", (_req, res) => {
  try {
    res.json(platform.listSgiClients());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/v1/market", (req, res) => {
  try {
    if (!requirePartner(req, res)) return;
    res.json(platform.listMarket());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/v1/orders", (req, res) => {
  try {
    if (!requirePartner(req, res)) return;
    applySession(req);
    res.json(platform.getOrders());
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/v1/orders", async (req, res) => {
  try {
    if (!requirePartner(req, res)) return;
    applySession(req);
    const { symbol, side, order_type, qty, price_limit } = req.body ?? {};
    const result = await platform.placeOrder({
      symbol,
      side,
      order_type,
      qty: Number(qty),
      price_limit:
        price_limit === undefined ? undefined : Number(price_limit),
    });
    res.status(result.rejected ? 422 : 200).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/openapi.json", (_req, res) => {
  res.json(openApiDocument);
});

app.get("/api/market", (_req, res) => {
  try {
    res.json(platform.listMarket());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/market/:symbol", (req, res) => {
  try {
    res.json(platform.getInstrument(req.params.symbol));
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/market/:symbol/book", async (req, res) => {
  try {
    res.json(await platform.getBook(req.params.symbol));
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/market/:symbol/candles", (req, res) => {
  try {
    res.json(platform.getCandles(req.params.symbol));
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    applySession(req);
    const { symbol, side, order_type, qty, price_limit } = req.body ?? {};
    const result = await platform.placeOrder({
      symbol,
      side,
      order_type,
      qty: Number(qty),
      price_limit:
        price_limit === undefined ? undefined : Number(price_limit),
    });
    res.status(result.rejected ? 422 : 200).json(result);
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/orders", (req, res) => {
  try {
    applySession(req);
    res.json(platform.getOrders());
  } catch (err) {
    handleError(res, err);
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    applySession(req);
    res.json(await platform.cancelOrder(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/portfolio", (req, res) => {
  try {
    applySession(req);
    res.json(platform.getPortfolio());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/trades", (_req, res) => {
  try {
    res.json(platform.getTrades());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/settlements", (_req, res) => {
  try {
    res.json(platform.getSettlements());
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/settlements/:id/confirm", (req, res) => {
  try {
    const confirmed = platform.confirmSettlement(req.params.id);
    if (!confirmed) {
      res.status(404).json({ error: "settlement_not_found" });
      return;
    }
    res.json(confirmed);
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/activity", (_req, res) => {
  try {
    res.json(platform.getActivity());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/admin/ops", async (_req, res) => {
  try {
    res.json(await platform.getOps());
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/admin/kill-switch", async (req, res) => {
  try {
    const symbol =
      typeof req.body?.symbol === "string" ? req.body.symbol : undefined;
    res.json(await platform.adminKillSwitch(symbol));
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/partner/stats", (_req, res) => {
  try {
    res.json(platform.getPartnerStats());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/education", (_req, res) => {
  res.json(platform.getEducation());
});

app.post("/api/demo", async (_req, res) => {
  try {
    const result = await runLot1Demo();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "demo_failed",
    });
  }
});

const staticDir = join(__dirname, "..", "dist");
if (existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get("*", (_req, res) => {
    res.sendFile(join(staticDir, "index.html"));
  });
}

app.listen(port, "0.0.0.0", () => {
  console.log(`AOTC App → http://0.0.0.0:${port}`);
});
