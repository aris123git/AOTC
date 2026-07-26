/**
 * Orchestration sandbox du scénario Lot 1 (12 étapes) — démonstration.
 * Ce n'est PAS un couplage permanent entre moteurs : c'est un script de démo
 * qui enchaîne les ports/contrats comme le ferait l'API Gateway + bus.
 */

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
import { InMemoryLeaderElection, InMemoryMessageBus } from "@aotc/message-bus";
import { RiskEngine } from "@aotc/engine-risk";
import { SorEngine } from "@aotc/engine-sor";
import { TradingEngine, InMemoryOrderBookRepository } from "@aotc/engine-trading";
import { LiquidityEngine } from "@aotc/engine-liquidity";
import { SettlementEngine } from "@aotc/engine-settlement";
import { TreasuryEngine } from "@aotc/engine-treasury";
import { PricingEngine } from "@aotc/engine-pricing";
import {
  TOPICS,
  createEnvelope,
  type OrderRequested,
  type TradeExecuted,
} from "@aotc/contracts";
import { InMemorySimulationJournal } from "./in-memory-journal.js";
import { JournalPublisher } from "./publisher.js";

export interface Lot1DemoResult {
  correlation_id: string;
  timeline: string[];
  order_id: string;
  trade_id: string | null;
  portfolio: { cash_available: number; holdings_qty: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Référentiel simulé (pas de hardcode métier BRVM dans le matching). */
function seedMarket(): {
  exchange: Exchange;
  market: Market;
  asset: Asset;
  instrument: Instrument;
  referencePrice: number;
} {
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
    id: asInstrumentId("ins_snts_demo"),
    asset_id: asset.id,
    exchange_id: exchange.id,
    market_id: market.id,
    local_symbol: "SNTS",
    tick_size: 5,
    lot_size: 1,
    status: "tradable",
  };
  return { exchange, market, asset, instrument, referencePrice: 15_000 };
}

/**
 * Exécute le parcours Lot 1 en sandbox et remplit le Simulation Journal.
 */
export async function runLot1Demo(): Promise<Lot1DemoResult> {
  const bus = new InMemoryMessageBus();
  const leadership = new InMemoryLeaderElection();
  const journal = new InMemorySimulationJournal();
  const publisher = new JournalPublisher(journal, bus);
  const env = "sandbox" as const;
  const correlation_id = crypto.randomUUID();

  const { exchange, market, asset, instrument, referencePrice } = seedMarket();
  const orderBook = new InMemoryOrderBookRepository();

  const risk = new RiskEngine();
  const sor = new SorEngine();
  const trading = new TradingEngine({ orderBook });
  const liquidity = new LiquidityEngine();
  const settlement = new SettlementEngine();
  const treasury = new TreasuryEngine();
  const pricing = new PricingEngine();

  const ctx = { bus, leadership, replica_id: "demo-1", environment: env };
  await Promise.all([
    risk.start(ctx),
    sor.start(ctx),
    trading.start(ctx),
    liquidity.start(ctx),
    settlement.start(ctx),
    treasury.start(ctx),
    pricing.start(ctx),
  ]);

  // --- 1–3 Auth / KYC / validation SGI (simulés) ---
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "auth",
    summary: "Investisseur : compte créé",
    severity: "success",
    scenario_step: 1,
    details: { user_id: "user_demo" },
  });
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "kyc",
    summary: "KYC : pièces soumises",
    severity: "info",
    scenario_step: 2,
  });
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "sgi",
    summary: "SGI : KYC validé",
    severity: "success",
    scenario_step: 3,
    details: { sgi_id: "sgi_demo" },
  });

  // --- 4 Dépôt simulé ---
  const deposit = 5_000_000; // minor units XOF
  let cash = deposit;
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "payments",
    summary: `Dépôt simulé : ${(deposit / 100).toLocaleString("fr-FR")} XOF`,
    severity: "success",
    scenario_step: 4,
    details: { amount: deposit },
  });

  // --- 5 Market data ---
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "marketdata",
    summary: `Actions disponibles : ${asset.symbol} @ ${referencePrice} (${exchange.code})`,
    severity: "info",
    scenario_step: 5,
    details: {
      instrument_id: instrument.id,
      exchange_id: exchange.id,
      market_id: market.id,
    },
  });

  // --- 6 Ordre d'achat ---
  const order: OrderRequested = {
    client_order_id: "co_demo_1",
    user_id: "user_demo",
    sgi_id: "sgi_demo",
    asset_id: asset.id,
    instrument_id: instrument.id,
    exchange_id: exchange.id,
    market_id: market.id,
    side: "buy",
    order_type: "limit",
    tif: "day",
    qty: 100,
    price_limit: referencePrice,
  };
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "investor",
    summary: `Ordre reçu : ACHAT ${order.qty} ${asset.symbol} @ ${order.price_limit}`,
    severity: "info",
    scenario_step: 6,
    details: order,
  });

  // Publie OrderRequested → Risk consomme
  await bus.publish(
    TOPICS.ORDERS_REQUESTED,
    createEnvelope({
      type: "OrderRequested",
      correlation_id,
      environment: env,
      payload: order,
      tenant: { sgi_id: order.sgi_id },
    }),
  );
  await sleep(5);

  // --- 7 Risk ---
  const riskDecision = await risk.evaluatePreTrade(order);
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "risk",
    summary: riskDecision.approved
      ? "Risk Engine : VALIDÉ"
      : `Risk Engine : REJETÉ (${riskDecision.reasons.join(", ")})`,
    severity: riskDecision.approved ? "success" : "error",
    scenario_step: 7,
    details: riskDecision,
  });
  if (!riskDecision.approved) {
    const timeline = await journal.formatTimeline(correlation_id);
    await stopAll([risk, sor, trading, liquidity, settlement, treasury, pricing]);
    return {
      correlation_id,
      timeline,
      order_id: "",
      trade_id: null,
      portfolio: { cash_available: cash, holdings_qty: 0 },
    };
  }

  // Treasury réserve (simulé)
  const cost = order.qty * (order.price_limit ?? referencePrice);
  const reserved = await treasury.reserve({
    reservation_id: crypto.randomUUID(),
    purpose: "order_cash_lock",
    amount: cost,
    correlation_id,
  });
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "treasury",
    summary: reserved.approved
      ? `Treasury : fonds réservés (${cost})`
      : "Treasury : réservation refusée",
    severity: reserved.approved ? "success" : "error",
    details: reserved,
  });

  // --- 8 SOR ---
  const routing = await sor.route(order, referencePrice);
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "sor",
    summary: `Smart Order Router : ${labelRoute(routing.route)}`,
    severity: "success",
    scenario_step: 8,
    details: routing,
  });

  // --- 9–10 Trading : OrderAccepted → carnet ---
  const order_id = crypto.randomUUID();
  await bus.publish(
    TOPICS.ORDERS_ACCEPTED,
    createEnvelope({
      type: "OrderAccepted",
      correlation_id,
      environment: env,
      payload: {
        ...order,
        order_id,
        instrument_id: instrument.id,
        exchange_id: exchange.id,
        market_id: market.id,
        reservation_ref: reserved.reservation_id,
        route: routing.route,
      },
      tenant: { sgi_id: order.sgi_id },
    }),
  );
  await sleep(15);

  await publisher.record({
    correlation_id,
    environment: env,
    actor: "trading",
    summary: "Trading Engine : ordre reçu et carnet mis à jour",
    severity: "success",
    scenario_step: 9,
    details: { order_id },
  });

  const snap = await orderBook.getSnapshot(instrument.id);
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "trading",
    summary: `Carnet d'ordres : ${snap.bids.length} niveau(x) bid, ${snap.asks.length} ask`,
    severity: "info",
    scenario_step: 10,
    details: { bids: snap.bids.length, asks: snap.asks.length },
  });

  // Contrepartie liquidité simulée (vente) pour produire un trade démonstrable
  const liq = await liquidity.decide(order.qty);
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "liquidity",
    summary: liq.approved
      ? `Liquidity Engine : Intervention approuvée (${liq.liquidity_mode})`
      : "Liquidity Engine : Intervention refusée",
    severity: liq.approved ? "success" : "warning",
    details: liq,
  });

  let trade_id: string | null = null;
  let holdings_qty = 0;
  if (liq.approved) {
    trade_id = crypto.randomUUID();
    const trade: TradeExecuted = {
      trade_id,
      asset_id: asset.id,
      instrument_id: instrument.id,
      exchange_id: exchange.id,
      market_id: market.id,
      buy_order_id: order_id,
      sell_order_id: "liq_inventory",
      qty: order.qty,
      price: referencePrice,
      buyer_sgi_id: order.sgi_id,
      seller_sgi_id: "sgi_partner_liquidity",
      aotc_as_principal: true,
      liquidity_source: "aotc_liquidity",
      executed_at: new Date().toISOString(),
    };
    await trading.publishTrade(trade, correlation_id, env);
    await sleep(15);

    await publisher.record({
      correlation_id,
      environment: env,
      actor: "trading",
      summary: `Trading Engine : Exécuté ${trade.qty} @ ${trade.price}`,
      severity: "success",
      details: trade,
    });

    // Settlement consomme TradeExecuted via bus
    await sleep(15);
    const settlements = bus.dump(TOPICS.SETTLEMENT_INSTRUCTED);
    if (settlements.length > 0) {
      await publisher.record({
        correlation_id,
        environment: env,
        actor: "settlement",
        summary: "Settlement Engine : Instruction T+3 créée",
        severity: "success",
        details: settlements[settlements.length - 1]?.payload as Record<string, unknown>,
      });
    }

    // --- 11 Portefeuille ---
    cash -= cost;
    holdings_qty = order.qty;
    await publisher.record({
      correlation_id,
      environment: env,
      actor: "portfolio",
      summary: `Portefeuille mis à jour : +${holdings_qty} ${asset.symbol}, cash=${cash}`,
      severity: "success",
      scenario_step: 11,
      details: { cash_available: cash, holdings_qty },
    });
  }

  // --- 12 Audit ---
  await publisher.record({
    correlation_id,
    environment: env,
    actor: "audit",
    summary: "Audit : parcours journalisé (correlation_id conservé)",
    severity: "info",
    scenario_step: 12,
    details: { correlation_id },
  });

  const timeline = await journal.formatTimeline(correlation_id);
  await stopAll([risk, sor, trading, liquidity, settlement, treasury, pricing]);

  return {
    correlation_id,
    timeline,
    order_id,
    trade_id,
    portfolio: { cash_available: cash, holdings_qty },
  };
}

function labelRoute(route: string): string {
  switch (route) {
    case "internal_book":
      return "Book interne";
    case "sgi_counterparty":
      return "Contrepartie SGI";
    case "aotc_liquidity":
      return "Liquidité AOTC";
    case "external_venue":
      return "Place externe";
    default:
      return route;
  }
}

async function stopAll(
  engines: Array<{ stop: () => Promise<void> }>,
): Promise<void> {
  await Promise.all(engines.map((e) => e.stop()));
}
