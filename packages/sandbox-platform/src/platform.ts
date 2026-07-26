/**
 * SandboxPlatform — session d'exchange AOTC in-memory (sandbox).
 * Orchestre bus + moteurs + journal sans couplage permanent inter-moteurs.
 */

import {
  asInstrumentId,
  type SimulationJournalEntry,
} from "@aotc/core";
import { InMemoryLeaderElection, InMemoryMessageBus } from "@aotc/message-bus";
import {
  InMemorySimulationJournal,
  JournalPublisher,
} from "@aotc/simulation-journal";
import { RiskEngine } from "@aotc/engine-risk";
import { SorEngine } from "@aotc/engine-sor";
import { TradingEngine, InMemoryOrderBookRepository } from "@aotc/engine-trading";
import { LiquidityEngine } from "@aotc/engine-liquidity";
import { SettlementEngine } from "@aotc/engine-settlement";
import { TreasuryEngine } from "@aotc/engine-treasury";
import { PricingEngine } from "@aotc/engine-pricing";
import { PartnerEngine } from "@aotc/engine-partner";
import { MonitoringEngine } from "@aotc/engine-monitoring";
import {
  TOPICS,
  createEnvelope,
  type OrderRequested,
  type OpsSnapshot,
  type TradeExecuted,
} from "@aotc/contracts";
import {
  createMarketSeed,
  DEFAULT_SGI_ID,
  LIQUIDITY_SEED_QTY,
  MM_SGI_ID,
  MM_USER_ID,
  type MarketSeed,
  type SeededEquity,
} from "./market-seed.js";
import type {
  CandleDto,
  EducationModuleDto,
  InstrumentDetailDto,
  MarketSymbolDto,
  OrderBookDto,
  OrderDto,
  PlaceOrderInput,
  PlaceOrderResult,
  PortfolioDto,
  SessionDto,
  SettlementDto,
  SignupInput,
  TradeDto,
  UserDto,
} from "./types.js";

type UserState = {
  id: string;
  name: string;
  email: string;
  kycStatus: "pending" | "approved";
  sgiId: string;
  cash: number;
  cashLocked: number;
  holdings: Map<string, number>; // asset_id -> qty
  holdingsLocked: Map<string, number>;
};

type TrackedOrder = OrderDto & {
  asset_id: string;
  instrument_id: string;
  user_id: string;
  reservation_id?: string;
  correlation_id: string;
};

const SPREAD_TICKS = 2;
const ENV = "sandbox" as const;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SandboxPlatform {
  private sessionId = crypto.randomUUID();
  private startedAt = new Date().toISOString();
  private started = false;

  private bus = new InMemoryMessageBus();
  private leadership = new InMemoryLeaderElection();
  private journal = new InMemorySimulationJournal();
  private publisher!: JournalPublisher;
  private orderBook = new InMemoryOrderBookRepository();

  private risk = new RiskEngine();
  private sor = new SorEngine();
  private trading!: TradingEngine;
  private liquidity = new LiquidityEngine();
  private settlement = new SettlementEngine();
  private treasury = new TreasuryEngine();
  private pricing = new PricingEngine();
  private partner = new PartnerEngine();
  private monitoring = new MonitoringEngine();

  private seed!: MarketSeed;
  private bySymbol = new Map<string, SeededEquity>();
  private lastPrice = new Map<string, number>();
  private openPrice = new Map<string, number>();

  private user: UserState | null = null;
  private orders: TrackedOrder[] = [];
  private trades: TradeDto[] = [];
  private sessionCorrelation = crypto.randomUUID();
  private rejectedOrders = 0;

  async start(): Promise<void> {
    if (this.started) return;
    await this.bootstrap();
    this.started = true;
  }

  async reset(): Promise<void> {
    await this.stopEngines();
    this.journal.clear();
    this.orderBook.clear();
    this.settlement.clear();
    this.partner.clear();
    this.monitoring.clear();
    this.treasury.reset();
    this.user = null;
    this.orders = [];
    this.trades = [];
    this.rejectedOrders = 0;
    this.sessionId = crypto.randomUUID();
    this.sessionCorrelation = crypto.randomUUID();
    this.startedAt = new Date().toISOString();
    this.started = false;
    await this.start();
  }

  getSession(): SessionDto {
    return {
      session_id: this.sessionId,
      environment: ENV,
      user: this.user ? this.toUserDto(this.user) : null,
      started_at: this.startedAt,
    };
  }

  async signup(input: SignupInput): Promise<UserDto> {
    this.requireStarted();
    const id = crypto.randomUUID();
    this.user = {
      id,
      name: input.name.trim(),
      email: input.email.trim().toLowerCase(),
      kycStatus: "pending",
      sgiId: DEFAULT_SGI_ID,
      cash: 0,
      cashLocked: 0,
      holdings: new Map(),
      holdingsLocked: new Map(),
    };
    await this.publisher.record({
      correlation_id: this.sessionCorrelation,
      environment: ENV,
      actor: "auth",
      summary: `Investisseur : compte créé (${this.user.email})`,
      severity: "success",
      details: { user_id: id, name: this.user.name },
    });
    return this.toUserDto(this.user);
  }

  async submitKyc(): Promise<UserDto> {
    const user = this.requireUser();
    await this.publisher.record({
      correlation_id: this.sessionCorrelation,
      environment: ENV,
      actor: "kyc",
      summary: "KYC : pièces soumises",
      severity: "info",
      details: { user_id: user.id },
    });
    // Sandbox : auto-approbation
    return this.approveKyc();
  }

  async approveKyc(): Promise<UserDto> {
    const user = this.requireUser();
    user.kycStatus = "approved";
    await this.publisher.record({
      correlation_id: this.sessionCorrelation,
      environment: ENV,
      actor: "sgi",
      summary: "SGI : KYC validé",
      severity: "success",
      details: { user_id: user.id, sgi_id: user.sgiId },
    });
    return this.toUserDto(user);
  }

  async deposit(amountMinor: number): Promise<PortfolioDto> {
    const user = this.requireUser();
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new Error("invalid_amount");
    }
    user.cash += amountMinor;
    this.treasury.credit(amountMinor);
    await this.publisher.record({
      correlation_id: this.sessionCorrelation,
      environment: ENV,
      actor: "payments",
      summary: `Dépôt Mobile Money simulé : ${formatXof(amountMinor)}`,
      severity: "success",
      details: { amount: amountMinor, channel: "mobile_money" },
    });
    return this.getPortfolio();
  }

  async withdraw(amountMinor: number): Promise<PortfolioDto> {
    const user = this.requireUser();
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new Error("invalid_amount");
    }
    if (user.cash < amountMinor) throw new Error("insufficient_cash");
    user.cash -= amountMinor;
    await this.publisher.record({
      correlation_id: this.sessionCorrelation,
      environment: ENV,
      actor: "payments",
      summary: `Retrait simulé : ${formatXof(amountMinor)}`,
      severity: "info",
      details: { amount: amountMinor },
    });
    return this.getPortfolio();
  }

  listMarket(): MarketSymbolDto[] {
    this.requireStarted();
    return [...this.bySymbol.values()].map((eq) => this.toMarketDto(eq));
  }

  getInstrument(symbol: string): InstrumentDetailDto {
    const eq = this.requireEquity(symbol);
    const base = this.toMarketDto(eq);
    return {
      ...base,
      exchange_id: eq.instrument.exchange_id,
      market_id: eq.instrument.market_id,
      tick_size: eq.instrument.tick_size,
      lot_size: eq.instrument.lot_size,
      reference_price: eq.reference_price,
      currency: eq.asset.currency,
    };
  }

  async getBook(symbol: string): Promise<OrderBookDto> {
    const eq = this.requireEquity(symbol);
    const snap = await this.orderBook.getSnapshot(eq.instrument.id);
    return {
      symbol: eq.asset.symbol,
      instrument_id: eq.instrument.id,
      bids: snap.bids,
      asks: snap.asks,
      updated_at: snap.updated_at,
    };
  }

  getCandles(symbol: string): CandleDto[] {
    return [...this.requireEquity(symbol).candles];
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const user = this.requireUser();
    const eq = this.requireEquity(input.symbol);
    const correlation_id = crypto.randomUUID();
    const client_order_id = crypto.randomUUID();
    const order_id = crypto.randomUUID();
    const created_at = new Date().toISOString();

    const quote = await this.pricing.quote(
      {
        asset_id: eq.asset.id,
        instrument_id: eq.instrument.id,
        side: input.side,
        qty: input.qty,
        purpose: "display",
      },
      eq.reference_price,
      eq.instrument.tick_size,
    );

    const estimatePrice =
      input.price_limit ??
      quote.price ??
      this.lastPrice.get(eq.asset.symbol) ??
      eq.reference_price;

    const orderReq: OrderRequested = {
      client_order_id,
      user_id: user.id,
      sgi_id: user.sgiId,
      asset_id: eq.asset.id,
      instrument_id: eq.instrument.id,
      exchange_id: this.seed.exchange.id,
      market_id: this.seed.market.id,
      side: input.side,
      order_type: input.order_type,
      tif: "day",
      qty: input.qty,
      price_limit:
        input.order_type === "limit"
          ? input.price_limit ?? estimatePrice
          : estimatePrice,
    };

    await this.publisher.record({
      correlation_id,
      environment: ENV,
      actor: "investor",
      summary: `Ordre reçu : ${input.side === "buy" ? "ACHAT" : "VENTE"} ${input.qty} ${eq.asset.symbol}`,
      severity: "info",
      details: { ...orderReq, order_id },
    });

    const riskDecision = await this.risk.evaluatePreTrade(orderReq, {
      kyc_ok: user.kycStatus === "approved",
      market_open: this.seed.market.status === "open",
      asset_tradable:
        eq.asset.status === "listed" && eq.instrument.status === "tradable",
      cash_available: user.cash,
      holdings_available:
        (user.holdings.get(eq.asset.id) ?? 0) -
        (user.holdingsLocked.get(eq.asset.id) ?? 0),
      max_order_qty: 10_000,
    });

    await this.publisher.record({
      correlation_id,
      environment: ENV,
      actor: "risk",
      summary: riskDecision.approved
        ? "Risk Engine : VALIDÉ"
        : `Risk Engine : REJETÉ (${riskDecision.reasons.join(", ")})`,
      severity: riskDecision.approved ? "success" : "error",
      details: riskDecision,
    });

    if (!riskDecision.approved) {
      this.rejectedOrders += 1;
      const rejected: TrackedOrder = {
        order_id,
        client_order_id,
        symbol: eq.asset.symbol,
        side: input.side,
        order_type: input.order_type,
        qty: input.qty,
        qty_filled: 0,
        qty_remaining: input.qty,
        price_limit: input.price_limit,
        status: "rejected",
        created_at,
        rejection_reasons: riskDecision.reasons,
        asset_id: eq.asset.id,
        instrument_id: eq.instrument.id,
        user_id: user.id,
        correlation_id,
      };
      this.orders.push(rejected);
      return { order: stripTracked(rejected), fills: [], rejected: true };
    }

    // Verrouillage cash / titres
    let reservation_id: string | undefined;
    if (input.side === "buy") {
      const lockAmount = input.qty * estimatePrice;
      user.cash -= lockAmount;
      user.cashLocked += lockAmount;
      const reserved = await this.treasury.reserve({
        reservation_id: crypto.randomUUID(),
        purpose: "order_cash_lock",
        amount: lockAmount,
        correlation_id,
      });
      reservation_id = reserved.reservation_id;
      await this.publisher.record({
        correlation_id,
        environment: ENV,
        actor: "treasury",
        summary: reserved.approved
          ? `Treasury : fonds réservés (${lockAmount})`
          : "Treasury : réservation refusée",
        severity: reserved.approved ? "success" : "error",
        details: reserved,
      });
      if (!reserved.approved) {
        user.cash += lockAmount;
        user.cashLocked -= lockAmount;
        this.rejectedOrders += 1;
        const rejected: TrackedOrder = {
          order_id,
          client_order_id,
          symbol: eq.asset.symbol,
          side: input.side,
          order_type: input.order_type,
          qty: input.qty,
          qty_filled: 0,
          qty_remaining: input.qty,
          price_limit: input.price_limit,
          status: "rejected",
          created_at,
          rejection_reasons: reserved.reasons,
          asset_id: eq.asset.id,
          instrument_id: eq.instrument.id,
          user_id: user.id,
          correlation_id,
        };
        this.orders.push(rejected);
        return { order: stripTracked(rejected), fills: [], rejected: true };
      }
    } else {
      const locked = user.holdingsLocked.get(eq.asset.id) ?? 0;
      user.holdingsLocked.set(eq.asset.id, locked + input.qty);
    }

    const routing = await this.sor.route(orderReq, eq.reference_price);
    await this.publisher.record({
      correlation_id,
      environment: ENV,
      actor: "sor",
      summary: `Smart Order Router : ${labelRoute(routing.route)}`,
      severity: "success",
      details: routing,
    });

    await this.publisher.record({
      correlation_id,
      environment: ENV,
      actor: "pricing",
      summary: `Cotation : ${quote.price} (spread ${quote.spread_bps} bps)`,
      severity: "info",
      details: quote,
    });

    this.partner.recordOrder(user.sgiId, input.qty);

    await this.bus.publish(
      TOPICS.ORDERS_ACCEPTED,
      createEnvelope({
        type: "OrderAccepted",
        correlation_id,
        environment: ENV,
        payload: {
          ...orderReq,
          order_id,
          instrument_id: eq.instrument.id,
          exchange_id: this.seed.exchange.id,
          market_id: this.seed.market.id,
          reservation_ref: reservation_id ?? "none",
          route: routing.route,
          price_limit: orderReq.price_limit,
        },
        tenant: { sgi_id: user.sgiId },
      }),
    );
    await sleep(10);

    // Retirer l'ordre auto-resté par le bus handler — matching contrôlé ici
    await this.orderBook.removeOrder(eq.instrument.id, order_id);

    const matchPrice =
      input.order_type === "market"
        ? input.side === "buy"
          ? Number.MAX_SAFE_INTEGER
          : 0
        : (orderReq.price_limit ?? estimatePrice);

    const match = await this.trading.matchIncoming({
      order_id,
      instrument_id: eq.instrument.id,
      side: input.side,
      price: matchPrice,
      qty: input.qty,
      user_id: user.id,
      sgi_id: user.sgiId,
    });

    const fills: TradeDto[] = [];
    let qtyRemaining = match.qty_remaining;
    let qtyFilled = 0;
    let notionalFilled = 0;

    for (const fill of match.fills) {
      const maker = await this.orderBook.getOrder(fill.maker_order_id);
      // maker may already be reduced/removed — recover meta from seed MM
      const makerIsMm =
        fill.maker_order_id.startsWith("mm_") ||
        maker?.user_id === MM_USER_ID ||
        maker?.sgi_id === MM_SGI_ID;

      const trade = await this.publishUserFill({
        trade_id: fill.trade_id,
        eq,
        qty: fill.qty,
        price: fill.price,
        side: input.side,
        order_id,
        maker_order_id: fill.maker_order_id,
        correlation_id,
        aotc_as_principal: false,
        liquidity_source: "internal_book",
        maker_sgi: makerIsMm ? MM_SGI_ID : maker?.sgi_id ?? "sgi_unknown",
      });
      fills.push(trade);
      qtyFilled += fill.qty;
      notionalFilled += fill.qty * fill.price;
      await this.applyFillToUser(user, eq, input.side, fill.qty, fill.price);
    }

    // Intervention liquidité — vente investisseur sans acheteur
    if (qtyRemaining > 0 && input.side === "sell") {
      const liq = await this.liquidity.decide(qtyRemaining, {
        asset_id: eq.asset.id,
        side: "buy",
        sector: eq.sector,
      });
      await this.publisher.record({
        correlation_id,
        environment: ENV,
        actor: "liquidity",
        summary: liq.approved
          ? `Liquidity Engine : Intervention acheteur approuvée (${liq.liquidity_mode})`
          : `Liquidity Engine : Intervention refusée (${liq.reasons.join(", ")})`,
        severity: liq.approved ? "success" : "warning",
        details: liq,
      });
      if (liq.approved) {
        const price = quote.price;
        const trade_id = crypto.randomUUID();
        const trade = await this.publishUserFill({
          trade_id,
          eq,
          qty: qtyRemaining,
          price,
          side: "sell",
          order_id,
          maker_order_id: "liq_inventory",
          correlation_id,
          aotc_as_principal: true,
          liquidity_source: "aotc_liquidity",
          maker_sgi: "sgi_partner_liquidity",
        });
        fills.push(trade);
        qtyFilled += qtyRemaining;
        notionalFilled += qtyRemaining * price;
        await this.applyFillToUser(user, eq, "sell", qtyRemaining, price);
        qtyRemaining = 0;
      }
    }

    // Intervention liquidité — achat market restant
    if (qtyRemaining > 0 && input.side === "buy" && input.order_type === "market") {
      const liq = await this.liquidity.decide(qtyRemaining, {
        asset_id: eq.asset.id,
        side: "sell",
        sector: eq.sector,
      });
      await this.publisher.record({
        correlation_id,
        environment: ENV,
        actor: "liquidity",
        summary: liq.approved
          ? `Liquidity Engine : Intervention vendeur (inventaire) approuvée`
          : `Liquidity Engine : Intervention refusée (${liq.reasons.join(", ")})`,
        severity: liq.approved ? "success" : "warning",
        details: liq,
      });
      if (liq.approved) {
        const price = quote.price;
        const trade_id = crypto.randomUUID();
        const trade = await this.publishUserFill({
          trade_id,
          eq,
          qty: qtyRemaining,
          price,
          side: "buy",
          order_id,
          maker_order_id: "liq_inventory",
          correlation_id,
          aotc_as_principal: true,
          liquidity_source: "aotc_liquidity",
          maker_sgi: "sgi_partner_liquidity",
        });
        fills.push(trade);
        qtyFilled += qtyRemaining;
        notionalFilled += qtyRemaining * price;
        await this.applyFillToUser(user, eq, "buy", qtyRemaining, price);
        qtyRemaining = 0;
      }
    }

    // Relâche les verrous non utilisés + ajuste le cash au notionnel réel
    if (input.side === "buy") {
      const lockedTotal = input.qty * estimatePrice;
      const used = notionalFilled;
      const delta = lockedTotal - used; // >0 trop réservé, <0 complément
      user.cashLocked = Math.max(0, user.cashLocked - lockedTotal);
      user.cash += delta;
      if (reservation_id && delta > 0) {
        this.treasury.release(reservation_id, delta);
      }
    } else {
      const locked = user.holdingsLocked.get(eq.asset.id) ?? 0;
      user.holdingsLocked.set(
        eq.asset.id,
        Math.max(0, locked - input.qty),
      );
    }

    let status: OrderDto["status"] = "accepted";
    if (qtyRemaining === 0) status = "filled";
    else if (qtyFilled > 0) status = "partial";

    if (qtyRemaining > 0 && input.order_type === "limit") {
      const restPrice = orderReq.price_limit ?? estimatePrice;
      await this.orderBook.upsertRestingOrder({
        instrument_id: eq.instrument.id,
        order_id,
        side: input.side,
        price: restPrice,
        qty: qtyRemaining,
        user_id: user.id,
        sgi_id: user.sgiId,
      });
      // Re-lock remaining for resting limit
      if (input.side === "buy") {
        const relock = qtyRemaining * restPrice;
        user.cash -= relock;
        user.cashLocked += relock;
      } else {
        const locked = user.holdingsLocked.get(eq.asset.id) ?? 0;
        user.holdingsLocked.set(eq.asset.id, locked + qtyRemaining);
      }
      status = qtyFilled > 0 ? "partial" : "resting";
      await this.publisher.record({
        correlation_id,
        environment: ENV,
        actor: "trading",
        summary: `Ordre reposant au carnet : ${qtyRemaining} @ ${restPrice}`,
        severity: "info",
        details: { order_id, qty_remaining: qtyRemaining, price: restPrice },
      });
    }

    const tracked: TrackedOrder = {
      order_id,
      client_order_id,
      symbol: eq.asset.symbol,
      side: input.side,
      order_type: input.order_type,
      qty: input.qty,
      qty_filled: qtyFilled,
      qty_remaining: qtyRemaining,
      price_limit: input.price_limit ?? orderReq.price_limit,
      avg_price: qtyFilled > 0 ? Math.round(notionalFilled / qtyFilled) : undefined,
      status,
      aotc_as_principal: fills.some((f) => f.aotc_as_principal),
      created_at,
      asset_id: eq.asset.id,
      instrument_id: eq.instrument.id,
      user_id: user.id,
      reservation_id,
      correlation_id,
    };
    this.orders.push(tracked);

    await this.publisher.record({
      correlation_id,
      environment: ENV,
      actor: "portfolio",
      summary: `Portefeuille mis à jour : cash=${user.cash}, ${eq.asset.symbol}=${user.holdings.get(eq.asset.id) ?? 0}`,
      severity: "success",
      details: {
        cash_available: user.cash,
        holdings_qty: user.holdings.get(eq.asset.id) ?? 0,
      },
    });

    await sleep(15); // laisser settlement / partner / monitoring consommer

    return { order: stripTracked(tracked), fills, rejected: false };
  }

  async cancelOrder(orderId: string): Promise<OrderDto> {
    const user = this.requireUser();
    const order = this.orders.find((o) => o.order_id === orderId);
    if (!order || order.user_id !== user.id) throw new Error("order_not_found");
    if (order.status !== "resting" && order.status !== "partial") {
      throw new Error("order_not_cancellable");
    }
    if (order.qty_remaining <= 0) throw new Error("order_not_cancellable");

    await this.orderBook.removeOrder(
      asInstrumentId(order.instrument_id),
      orderId,
    );

    if (order.side === "buy") {
      const px = order.price_limit ?? 0;
      const unlock = order.qty_remaining * px;
      user.cashLocked = Math.max(0, user.cashLocked - unlock);
      user.cash += unlock;
      if (order.reservation_id) this.treasury.release(order.reservation_id, unlock);
    } else {
      const locked = user.holdingsLocked.get(order.asset_id) ?? 0;
      user.holdingsLocked.set(
        order.asset_id,
        Math.max(0, locked - order.qty_remaining),
      );
    }

    order.status = "cancelled";
    order.qty_remaining = 0;
    await this.publisher.record({
      correlation_id: order.correlation_id,
      environment: ENV,
      actor: "trading",
      summary: `Ordre annulé : ${order.symbol} ${order.order_id}`,
      severity: "info",
      details: { order_id: orderId },
    });
    return stripTracked(order);
  }

  getPortfolio(): PortfolioDto {
    const user = this.requireUser();
    const holdings = [...user.holdings.entries()].map(([asset_id, qty]) => {
      const eq = [...this.bySymbol.values()].find((e) => e.asset.id === asset_id);
      return {
        symbol: eq?.asset.symbol ?? asset_id,
        asset_id,
        qty,
        locked: user.holdingsLocked.get(asset_id) ?? 0,
      };
    });
    return {
      user_id: user.id,
      cash_available: user.cash,
      cash_locked: user.cashLocked,
      holdings,
    };
  }

  getOrders(): OrderDto[] {
    const user = this.requireUser();
    return this.orders
      .filter((o) => o.user_id === user.id)
      .map(stripTracked);
  }

  getTrades(): TradeDto[] {
    return [...this.trades];
  }

  getSettlements(): SettlementDto[] {
    return this.settlement.list().map((s) => {
      const eq = [...this.bySymbol.values()].find(
        (e) => e.asset.id === s.asset_id,
      );
      return {
        settlement_id: s.settlement_id,
        trade_id: s.trade_id,
        symbol: eq?.asset.symbol,
        qty: s.qty,
        amount: s.amount,
        settlement_date: s.settlement_date,
        status: s.status,
        confirmed_at: s.confirmed_at,
      };
    });
  }

  confirmSettlement(settlementId?: string) {
    if (settlementId) return this.settlement.confirm(settlementId);
    return this.settlement.confirmOldest();
  }

  getActivity(): {
    session_correlation_id: string;
    timeline: string[];
    entries: SimulationJournalEntry[];
  } {
    return {
      session_correlation_id: this.sessionCorrelation,
      timeline: this.journal
        .all()
        .map(
          (e) =>
            `${e.occurred_at.slice(11, 19)}  ${e.summary}`,
        ),
      entries: this.journal.all(),
    };
  }

  async getOps(): Promise<OpsSnapshot> {
    const engines = [
      this.trading,
      this.liquidity,
      this.treasury,
      this.settlement,
      this.risk,
      this.pricing,
      this.sor,
    ] as const;
    const healthEntries = await Promise.all(
      engines.map(async (e) => [e.name, await e.health()] as const),
    );
    const engines_health = Object.fromEntries(healthEntries) as OpsSnapshot["engines_health"];
    engines_health.marketdata = "up";
    engines_health.decision = "up";

    return {
      ts: new Date().toISOString(),
      orders_per_min: this.orders.length,
      failures: {
        rejected_orders: this.rejectedOrders,
        failed_payments: 0,
        failed_settlements: 0,
      },
      pending: {
        payments: 0,
        settlements: this.settlement
          .list()
          .filter((s) => s.status === "instructed").length,
      },
      risk_alerts_open: this.monitoring.alerts().length,
      engines_health,
    };
  }

  getPartnerStats(sgiId = DEFAULT_SGI_ID) {
    return this.partner.snapshot(sgiId, "sandbox-session");
  }

  getEducation(): EducationModuleDto[] {
    return EDUCATION_MODULES;
  }

  async adminKillSwitch(symbol?: string): Promise<{ suspended: string[] }> {
    this.requireStarted();
    const suspended: string[] = [];
    if (symbol) {
      const eq = this.requireEquity(symbol);
      eq.instrument.status = "suspended";
      eq.asset.status = "suspended";
      suspended.push(eq.asset.symbol);
    } else {
      for (const eq of this.bySymbol.values()) {
        eq.instrument.status = "suspended";
        eq.asset.status = "suspended";
        suspended.push(eq.asset.symbol);
      }
      this.seed.market.status = "halted";
    }
    await this.publisher.record({
      correlation_id: this.sessionCorrelation,
      environment: ENV,
      actor: "system",
      summary: symbol
        ? `Kill-switch : ${symbol} suspendu`
        : "Kill-switch : marché suspendu",
      severity: "warning",
      details: { suspended },
    });
    return { suspended };
  }

  // --- internals ---

  private async bootstrap(): Promise<void> {
    this.bus = new InMemoryMessageBus();
    this.leadership = new InMemoryLeaderElection();
    this.journal = new InMemorySimulationJournal();
    this.publisher = new JournalPublisher(this.journal, this.bus);
    this.orderBook = new InMemoryOrderBookRepository();

    this.risk = new RiskEngine();
    this.sor = new SorEngine();
    this.trading = new TradingEngine({ orderBook: this.orderBook });
    this.liquidity = new LiquidityEngine();
    this.settlement = new SettlementEngine();
    this.treasury = new TreasuryEngine();
    this.pricing = new PricingEngine();
    this.partner = new PartnerEngine();
    this.monitoring = new MonitoringEngine();

    this.seed = createMarketSeed();
    this.bySymbol = new Map(
      this.seed.equities.map((e) => [e.asset.symbol, e]),
    );
    this.lastPrice = new Map(
      this.seed.equities.map((e) => [e.asset.symbol, e.reference_price]),
    );
    this.openPrice = new Map(
      this.seed.equities.map((e) => [
        e.asset.symbol,
        e.candles[0]?.open ?? e.reference_price,
      ]),
    );

    const ctx = {
      bus: this.bus,
      leadership: this.leadership,
      replica_id: "sandbox-1",
      environment: ENV,
    };

    await Promise.all([
      this.risk.start(ctx),
      this.sor.start(ctx),
      this.trading.start(ctx),
      this.liquidity.start(ctx),
      this.settlement.start(ctx),
      this.treasury.start(ctx),
      this.pricing.start(ctx),
      this.partner.start(ctx),
      this.monitoring.start(ctx),
    ]);

    for (const eq of this.seed.equities) {
      this.liquidity.seedInventory(eq.asset.id, LIQUIDITY_SEED_QTY);
    }

    await this.seedMarketMakerBook();

    await this.publisher.record({
      correlation_id: this.sessionCorrelation,
      environment: ENV,
      actor: "system",
      summary: `Session sandbox démarrée — ${this.seed.equities.length} actions DEMO`,
      severity: "info",
      details: { session_id: this.sessionId },
    });
  }

  private async seedMarketMakerBook(): Promise<void> {
    for (const eq of this.seed.equities) {
      const tick = eq.instrument.tick_size;
      const askPx = eq.reference_price + SPREAD_TICKS * tick;
      const bidPx = eq.reference_price - SPREAD_TICKS * tick;
      await this.orderBook.upsertRestingOrder({
        instrument_id: eq.instrument.id,
        order_id: `mm_ask_${eq.asset.symbol}`,
        side: "sell",
        price: askPx,
        qty: 200,
        user_id: MM_USER_ID,
        sgi_id: MM_SGI_ID,
      });
      await this.orderBook.upsertRestingOrder({
        instrument_id: eq.instrument.id,
        order_id: `mm_bid_${eq.asset.symbol}`,
        side: "buy",
        price: bidPx,
        qty: 100,
        user_id: MM_USER_ID,
        sgi_id: MM_SGI_ID,
      });
    }
  }

  private async publishUserFill(args: {
    trade_id: string;
    eq: SeededEquity;
    qty: number;
    price: number;
    side: "buy" | "sell";
    order_id: string;
    maker_order_id: string;
    correlation_id: string;
    aotc_as_principal: boolean;
    liquidity_source: TradeExecuted["liquidity_source"];
    maker_sgi: string;
  }): Promise<TradeDto> {
    const user = this.requireUser();
    const buy_order_id =
      args.side === "buy" ? args.order_id : args.maker_order_id;
    const sell_order_id =
      args.side === "sell" ? args.order_id : args.maker_order_id;
    const buyer_sgi_id =
      args.side === "buy" ? user.sgiId : args.maker_sgi;
    const seller_sgi_id =
      args.side === "sell" ? user.sgiId : args.maker_sgi;

    const trade: TradeExecuted = {
      trade_id: args.trade_id,
      asset_id: args.eq.asset.id,
      instrument_id: args.eq.instrument.id,
      exchange_id: this.seed.exchange.id,
      market_id: this.seed.market.id,
      buy_order_id,
      sell_order_id,
      qty: args.qty,
      price: args.price,
      buyer_sgi_id,
      seller_sgi_id,
      aotc_as_principal: args.aotc_as_principal,
      liquidity_source: args.liquidity_source,
      executed_at: new Date().toISOString(),
    };

    await this.trading.publishTrade(trade, args.correlation_id, ENV);
    await this.publisher.record({
      correlation_id: args.correlation_id,
      environment: ENV,
      actor: "trading",
      summary: `Trading Engine : Exécuté ${trade.qty} ${args.eq.asset.symbol} @ ${trade.price}${
        args.aotc_as_principal ? " (AOTC principal)" : ""
      }`,
      severity: "success",
      details: trade,
    });

    this.lastPrice.set(args.eq.asset.symbol, args.price);
    const dto: TradeDto = {
      trade_id: trade.trade_id,
      symbol: args.eq.asset.symbol,
      qty: trade.qty,
      price: trade.price,
      side: args.side,
      order_id: args.order_id,
      aotc_as_principal: trade.aotc_as_principal,
      liquidity_source: trade.liquidity_source,
      executed_at: trade.executed_at,
    };
    this.trades.push(dto);
    return dto;
  }

  /**
   * Applique un fill au portefeuille utilisateur.
   * Les montants buy sont déjà (partiellement) verrouillés — on déduit du lock.
   */
  private async applyFillToUser(
    user: UserState,
    eq: SeededEquity,
    side: "buy" | "sell",
    qty: number,
    price: number,
  ): Promise<void> {
    if (side === "buy") {
      const cost = qty * price;
      // Le cash a été verrouillé à l'estimate ; ajustement fin à la clôture d'ordre.
      // Ici on crédite les titres immédiatement (sandbox T+0 holdings).
      user.holdings.set(
        eq.asset.id,
        (user.holdings.get(eq.asset.id) ?? 0) + qty,
      );
      void cost;
    } else {
      const have = user.holdings.get(eq.asset.id) ?? 0;
      user.holdings.set(eq.asset.id, Math.max(0, have - qty));
      user.cash += qty * price;
    }
  }

  private async stopEngines(): Promise<void> {
    const engines = [
      this.risk,
      this.sor,
      this.trading,
      this.liquidity,
      this.settlement,
      this.treasury,
      this.pricing,
      this.partner,
      this.monitoring,
    ];
    await Promise.all(
      engines.filter(Boolean).map((e) => e.stop().catch(() => undefined)),
    );
  }

  private requireStarted(): void {
    if (!this.started) throw new Error("platform_not_started");
  }

  private requireUser(): UserState {
    this.requireStarted();
    if (!this.user) throw new Error("not_authenticated");
    return this.user;
  }

  private requireEquity(symbol: string): SeededEquity {
    this.requireStarted();
    const eq = this.bySymbol.get(symbol.toUpperCase());
    if (!eq) throw new Error("unknown_symbol");
    return eq;
  }

  private toUserDto(u: UserState): UserDto {
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      kyc_status: u.kycStatus,
      sgi_id: u.sgiId,
    };
  }

  private toMarketDto(eq: SeededEquity): MarketSymbolDto {
    const last = this.lastPrice.get(eq.asset.symbol) ?? eq.reference_price;
    const open = this.openPrice.get(eq.asset.symbol) ?? eq.reference_price;
    const change_bps =
      open > 0 ? Math.round(((last - open) / open) * 10_000) : 0;
    return {
      symbol: eq.asset.symbol,
      name: eq.asset.name,
      sector: eq.sector,
      last,
      change_bps,
      instrument_id: eq.instrument.id,
      asset_id: eq.asset.id,
      status: eq.instrument.status,
    };
  }
}

function stripTracked(o: TrackedOrder): OrderDto {
  const {
    asset_id: _a,
    instrument_id: _i,
    user_id: _u,
    reservation_id: _r,
    correlation_id: _c,
    ...dto
  } = o;
  return dto;
}

function formatXof(minor: number): string {
  return `${minor.toLocaleString("fr-FR")} XOF`;
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

const EDUCATION_MODULES: EducationModuleDto[] = [
  {
    id: "intro-marche",
    title: "Qu'est-ce qu'un marché OTC ?",
    summary: "Comprendre l'échange de titres hors carnet centralisé.",
    body: [
      "OTC signifie « Over The Counter » : les ordres peuvent être appariés en bilatéral ou via un facilitateur de liquidité.",
      "AOTC combine un carnet interne, le routage intelligent et une intervention de liquidité contrôlée.",
    ],
  },
  {
    id: "ordre-limite",
    title: "Ordre limité vs ordre au marché",
    summary: "Choisir le bon type d'ordre selon votre objectif.",
    body: [
      "Un ordre limité précise le prix maximum (achat) ou minimum (vente) acceptable.",
      "Un ordre au marché vise l'exécution immédiate au mieux disponible, y compris via la liquidité AOTC.",
    ],
  },
  {
    id: "reglement-t3",
    title: "Règlement-livraison T+3",
    summary: "Du trade à la confirmation de règlement.",
    body: [
      "Après exécution, le Settlement Engine émet une instruction de règlement.",
      "En sandbox, vous pouvez confirmer manuellement les instructions pour simuler le cycle T+3.",
    ],
  },
  {
    id: "risque-kyc",
    title: "KYC et contrôles pré-trade",
    summary: "Pourquoi un ordre peut être rejeté.",
    body: [
      "Le Risk Engine vérifie l'identité (KYC), l'ouverture du marché, la négociabilité et les fonds ou titres disponibles.",
      "Sans solde suffisant, un achat est rejeté avec le motif insufficient_funds.",
    ],
  },
];

export function createPlatform(): SandboxPlatform {
  return new SandboxPlatform();
}
