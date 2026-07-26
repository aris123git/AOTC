import express from "express";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runLot1Demo } from "@aotc/simulation-journal";
import { createPlatform } from "@aotc/sandbox-platform";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(express.json());

const platform = createPlatform();
await platform.start();

function handleError(res: express.Response, err: unknown): void {
  const message = err instanceof Error ? err.message : "error";
  const status =
    message === "not_authenticated"
      ? 401
      : message === "unknown_symbol" || message === "order_not_found"
        ? 404
        : message.startsWith("invalid_") ||
            message === "insufficient_cash" ||
            message === "order_not_cancellable"
          ? 400
          : 500;
  res.status(status).json({ error: message });
}

app.post("/api/session/reset", async (_req, res) => {
  try {
    await platform.reset();
    res.json(platform.getSession());
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/session", (_req, res) => {
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

app.post("/api/kyc/submit", async (_req, res) => {
  try {
    const user = await platform.submitKyc();
    res.json(user);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/payments/deposit", async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const portfolio = await platform.deposit(amount);
    res.json(portfolio);
  } catch (err) {
    handleError(res, err);
  }
});

app.post("/api/payments/withdraw", async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    const portfolio = await platform.withdraw(amount);
    res.json(portfolio);
  } catch (err) {
    handleError(res, err);
  }
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

app.get("/api/orders", (_req, res) => {
  try {
    res.json(platform.getOrders());
  } catch (err) {
    handleError(res, err);
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    res.json(await platform.cancelOrder(req.params.id));
  } catch (err) {
    handleError(res, err);
  }
});

app.get("/api/portfolio", (_req, res) => {
  try {
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
