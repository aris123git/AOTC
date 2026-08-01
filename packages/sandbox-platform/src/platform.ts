/**
 * SandboxPlatform — session d'exchange AOTC (sandbox Lot 2).
 * Orchestre bus + moteurs + journal + persist optionnelle.
 * Les moteurs ne s'importent pas entre eux ; la DB reste hors engines.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  asInstrumentId,
  type SimulationJournalActor,
  type SimulationJournalEntry,
} from "@aotc/core";
import { InMemoryLeaderElection, InMemoryMessageBus } from "@aotc/message-bus";
import {
  InMemorySimulationJournal,
  JournalPublisher,
} from "@aotc/simulation-journal";
import { PersistStore } from "@aotc/persist";
import {
  OtpService,
  createApiKey,
  createSessionToken,
  generateTotpSecret,
  hashApiKey,
  otpauthUrl,
  verifyTotp,
} from "@aotc/auth";
import { RiskEngine } from "@aotc/engine-risk";
import { SorEngine } from "@aotc/engine-sor";
import { TradingEngine, InMemoryOrderBookRepository } from "@aotc/engine-trading";
import { LiquidityEngine } from "@aotc/engine-liquidity";
import { SettlementEngine } from "@aotc/engine-settlement";
import { TreasuryEngine } from "@aotc/engine-treasury";
import { PricingEngine } from "@aotc/engine-pricing";
import { PartnerEngine } from "@aotc/engine-partner";
import { MonitoringEngine } from "@aotc/engine-monitoring";
import { DecisionEngine } from "@aotc/engine-decision";
import { MarketDataEngine } from "@aotc/engine-market-data";
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
  ApiKeyDto,
  AuthSessionResult,
  CandleDto,
  CreatePlatformOpts,
  DecisionSignalDto,
  EducationModuleDto,
  GovernanceAction,
  GovernanceProposalDto,
  InstrumentDetailDto,
  LiquidityMode,
  MarketSymbolDto,
  MfaSetupResult,
  OrderBookDto,
  OrderDto,
  OtpRequestResult,
  PaymentIntentDto,
  PlaceOrderInput,
  PlaceOrderResult,
  PortfolioDto,
  PriceTickDto,
  SessionDto,
  SettlementDto,
  SgiClientDto,
  SignupInput,
  TradeDto,
  TreasurySnapshotDto,
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
  holdings: Map<string, number>;
  holdingsLocked: Map<string, number>;
  mfaSecret: string | null;
  mfaEnabled: boolean;
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
const WEBHOOK_SECRET = "aotc_sandbox_whsec";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SandboxPlatform {
  private readonly opts: CreatePlatformOpts;
  private store: PersistStore | null = null;

  private sessionId = crypto.randomUUID();
  private startedAt = new Date().toISOString();
  private started = false;
  private sessionToken: string | null = null;

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
  private decision = new DecisionEngine();
  private marketData = new MarketDataEngine();

  private otp = new OtpService();
  private sessions = new Map<string, string>(); // token -> userId
  private usersById = new Map<string, UserState>();
  private decisionSignals: DecisionSignalDto[] = [];
  private paymentIntents: PaymentIntentDto[] = [];
  private proposals: GovernanceProposalDto[] = [];
  private apiKeysMeta: ApiKeyDto[] = [];
  private apiKeyHashes = new Map<string, string>(); // id -> hash

  private seed!: MarketSeed;
  private bySymbol = new Map<string, SeededEquity>();
  private lastPrice = new Map<string, number>();
  private openPrice = new Map<string, number>();

  private user: UserState | null = null;
  private orders: TrackedOrder[] = [];
  private trades: TradeDto[] = [];
  private sessionCorrelation = crypto.randomUUID();
  private rejectedOrders = 0;
  private pendingMfaSecret: string | null = null;

  constructor(opts: CreatePlatformOpts = {}) {
    this.opts = opts;
    if (opts.dbPath) {
      this.store = new PersistStore(opts.dbPath);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.bootstrap();
    this.loadFromStore();
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
    this.otp.clear();
    this.user = null;
    this.usersById.clear();
    this.orders = [];
    this.trades = [];
    this.decisionSignals = [];
    this.paymentIntents = [];
    this.proposals = [];
    this.apiKeysMeta = [];
    this.apiKeyHashes.clear();
    this.sessions.clear();
    this.sessionToken = null;
    this.pendingMfaSecret = null;
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
      session_token: this.sessionToken,
    };
  }

  async signup(input: SignupInput): Promise<UserDto> {
    this.requireStarted();
    const email = input.email.trim().toLowerCase();
    const existing = this.findUserByEmail(email);
    if (existing) {
      this.user = existing;
      return this.toUserDto(existing);
    }
    const id = crypto.randomUUID();
    const user: UserState = {
      id,
      name: input.name.trim(),
      email,
      kycStatus: "pending",
      sgiId: DEFAULT_SGI_ID,
      cash: 0,
      cashLocked: 0,
      holdings: new Map(),
      holdingsLocked: new Map(),
      mfaSecret: null,
      mfaEnabled: false,
    };
    this.usersById.set(id, user);
    this.user = user;
    this.persistUser(user);
    await this.recordAudit("auth", `Investisseur : compte créé (${email})`, "success", {
      user_id: id,
      name: user.name,
    });
    return this.toUserDto(user);
  }

  async requestOtp(email: string): Promise<OtpRequestResult> {
    this.requireStarted();
    const normalized = email.trim().toLowerCase();
    const { code, expires_at } = await this.otp.request(normalized);
    await this.recordAudit("auth", `OTP envoyé (sandbox) → ${normalized}`, "info", {
      email: normalized,
      dev_code: code,
    });
    return { email: normalized, dev_code: code, expires_at };
  }

  async verifyOtp(email: string, code: string): Promise<AuthSessionResult> {
    this.requireStarted();
    const ok = await this.otp.verify(email, code);
    if (!ok) throw new Error("invalid_otp");
    let user = this.findUserByEmail(email);
    if (!user) {
      await this.signup({ name: email.split("@")[0] || "Investisseur", email });
      user = this.requireUser();
    } else {
      this.user = user;
    }
    const session_token = createSessionToken();
    this.sessions.set(session_token, user.id);
    this.sessionToken = session_token;
    await this.recordAudit("auth", `OTP vérifié — session ouverte`, "success", {
      user_id: user.id,
    });
    return { session_token, user: this.toUserDto(user) };
  }

  async setupMfa(): Promise<MfaSetupResult> {
    const user = this.requireUser();
    const secret = generateTotpSecret();
    this.pendingMfaSecret = secret;
    const otpauth_url = otpauthUrl({
      secret,
      accountName: user.email,
      issuer: "AOTC",
    });
    await this.recordAudit("auth", "MFA : secret généré (en attente de vérif)", "info", {
      user_id: user.id,
    });
    return { secret, otpauth_url };
  }

  async verifyMfa(code: string): Promise<UserDto> {
    const user = this.requireUser();
    const secret = this.pendingMfaSecret ?? user.mfaSecret;
    if (!secret) throw new Error("mfa_not_setup");
    if (!verifyTotp(secret, code)) throw new Error("invalid_mfa");
    user.mfaSecret = secret;
    user.mfaEnabled = true;
    this.pendingMfaSecret = null;
    this.persistUser(user);
    this.store?.setUserMfa(user.id, secret, true);
    await this.recordAudit("auth", "MFA activé", "success", { user_id: user.id });
    return this.toUserDto(user);
  }

  async login(
    email: string,
    otp: string,
    mfa?: string,
  ): Promise<AuthSessionResult> {
    this.requireStarted();
    const ok = await this.otp.verify(email, otp);
    if (!ok) throw new Error("invalid_otp");
    const user = this.findUserByEmail(email);
    if (!user) throw new Error("user_not_found");
    if (user.mfaEnabled) {
      if (!mfa || !user.mfaSecret || !verifyTotp(user.mfaSecret, mfa)) {
        throw new Error("invalid_mfa");
      }
    }
    this.user = user;
    const session_token = createSessionToken();
    this.sessions.set(session_token, user.id);
    this.sessionToken = session_token;
    await this.recordAudit("auth", `Login sandbox (${user.email})`, "success", {
      user_id: user.id,
    });
    return { session_token, user: this.toUserDto(user) };
  }

  useSession(token: string | undefined | null): UserDto | null {
    if (!token) return this.user ? this.toUserDto(this.user) : null;
    const userId = this.sessions.get(token);
    if (!userId) return null;
    const user = this.usersById.get(userId);
    if (!user) return null;
    this.user = user;
    this.sessionToken = token;
    return this.toUserDto(user);
  }

  async submitKyc(): Promise<UserDto> {
    const user = this.requireUser();
    await this.recordAudit("kyc", "KYC : pièces soumises", "info", {
      user_id: user.id,
    });
    return this.approveKyc();
  }

  async approveKyc(): Promise<UserDto> {
    const user = this.requireUser();
    user.kycStatus = "approved";
    this.persistUser(user);
    this.store?.setUserKyc(user.id, "approved");
    await this.recordAudit("sgi", "SGI : KYC validé", "success", {
      user_id: user.id,
      sgi_id: user.sgiId,
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
    this.persistUser(user);
    await this.recordAudit(
      "payments",
      `Dépôt Mobile Money simulé : ${formatXof(amountMinor)}`,
      "success",
      { amount: amountMinor, channel: "mobile_money" },
    );
    return this.getPortfolio();
  }

  async withdraw(amountMinor: number): Promise<PortfolioDto> {
    const user = this.requireUser();
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw new Error("invalid_amount");
    }
    if (user.cash < amountMinor) throw new Error("insufficient_cash");
    user.cash -= amountMinor;
    this.persistUser(user);
    await this.recordAudit(
      "payments",
      `Retrait simulé : ${formatXof(amountMinor)}`,
      "info",
      { amount: amountMinor },
    );
    return this.getPortfolio();
  }

  async createDepositIntent(
    amount: number,
    kind: "deposit" | "withdraw" = "deposit",
    idempotencyKey?: string,
  ): Promise<PaymentIntentDto> {
    const user = this.requireUser();
    if (!Number.isInteger(amount) || amount <= 0) throw new Error("invalid_amount");
    const idempotency_key =
      idempotencyKey ?? `idem_${user.id}_${kind}_${amount}_${Date.now()}`;
    if (this.store) {
      const existing = this.store.getPaymentIntentByIdempotency(idempotency_key);
      if (existing) return mapPayment(existing);
    }
    const existingMem = this.paymentIntents.find(
      (p) => p.idempotency_key === idempotency_key,
    );
    if (existingMem) return existingMem;

    const id = crypto.randomUUID();
    const intent: PaymentIntentDto = {
      id,
      user_id: user.id,
      kind,
      amount,
      status: "pending",
      idempotency_key,
      created_at: new Date().toISOString(),
    };
    this.paymentIntents.push(intent);
    this.store?.insertPaymentIntent({
      id,
      user_id: user.id,
      kind,
      amount,
      idempotency_key,
      status: "pending",
      created_at: intent.created_at,
    });
    await this.recordAudit(
      "payments",
      `Intent ${kind} créé : ${formatXof(amount)}`,
      "info",
      { intent_id: id },
    );
    return intent;
  }

  async confirmPaymentWebhook(
    intentId: string,
    signature: string,
  ): Promise<PaymentIntentDto> {
    this.requireStarted();
    if (!this.validWebhookSignature(intentId, signature)) {
      throw new Error("invalid_webhook_signature");
    }
    let intent =
      this.paymentIntents.find((p) => p.id === intentId) ?? null;
    if (!intent && this.store) {
      const row = this.store.getPaymentIntent(intentId);
      if (row) intent = mapPayment(row);
    }
    if (!intent) throw new Error("intent_not_found");
    if (intent.status === "succeeded") return intent;

    const user = this.usersById.get(intent.user_id);
    if (!user) throw new Error("user_not_found");

    if (intent.kind === "deposit") {
      user.cash += intent.amount;
      this.treasury.credit(intent.amount);
    } else {
      if (user.cash < intent.amount) {
        intent = { ...intent, status: "failed" };
        this.patchIntent(intent);
        throw new Error("insufficient_cash");
      }
      user.cash -= intent.amount;
    }
    this.persistUser(user);
    if (this.user?.id === user.id) this.user = user;

    intent = { ...intent, status: "succeeded" };
    this.patchIntent(intent);
    await this.recordAudit(
      "payments",
      `Webhook paiement confirmé : ${intent.kind} ${formatXof(intent.amount)}`,
      "success",
      { intent_id: intentId },
    );
    return intent;
  }

  getPaymentIntents(): PaymentIntentDto[] {
    this.requireStarted();
    return [...this.paymentIntents];
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

  getTicks(): PriceTickDto[] {
    this.requireStarted();
    const symbolByAsset = new Map<string, string>(
      [...this.bySymbol.values()].map((e) => [
        String(e.asset.id),
        e.asset.symbol,
      ]),
    );
    return this.marketData.getLastTicks().map((t) => ({
      ...t,
      symbol: symbolByAsset.get(t.asset_id),
    }));
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

    await this.recordAudit(
      "investor",
      `Ordre reçu : ${input.side === "buy" ? "ACHAT" : "VENTE"} ${input.qty} ${eq.asset.symbol}`,
      "info",
      { ...orderReq, order_id },
      correlation_id,
    );

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

    await this.recordAudit(
      "risk",
      riskDecision.approved
        ? "Risk Engine : VALIDÉ"
        : `Risk Engine : REJETÉ (${riskDecision.reasons.join(", ")})`,
      riskDecision.approved ? "success" : "error",
      riskDecision,
      correlation_id,
    );

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
      this.persistOrder(rejected);
      return { order: stripTracked(rejected), fills: [], rejected: true };
    }

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
      await this.recordAudit(
        "treasury",
        reserved.approved
          ? `Treasury : fonds réservés (${lockAmount})`
          : "Treasury : réservation refusée",
        reserved.approved ? "success" : "error",
        reserved,
        correlation_id,
      );
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
        this.persistOrder(rejected);
        return { order: stripTracked(rejected), fills: [], rejected: true };
      }
    } else {
      const locked = user.holdingsLocked.get(eq.asset.id) ?? 0;
      user.holdingsLocked.set(eq.asset.id, locked + input.qty);
    }

    const routing = await this.sor.route(orderReq, eq.reference_price);
    await this.recordAudit(
      "sor",
      `Smart Order Router : ${labelRoute(routing.route)}`,
      "success",
      routing,
      correlation_id,
    );

    await this.recordAudit(
      "pricing",
      `Cotation : ${quote.price} (spread ${quote.spread_bps} bps)`,
      "info",
      quote,
      correlation_id,
    );

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

    if (qtyRemaining > 0 && input.side === "sell") {
      const liq = await this.liquidity.decide(qtyRemaining, {
        asset_id: eq.asset.id,
        side: "buy",
        sector: eq.sector,
      });
      await this.recordAudit(
        "liquidity",
        liq.approved
          ? `Liquidity Engine : Intervention acheteur approuvée (${liq.liquidity_mode})`
          : `Liquidity Engine : Intervention refusée (${liq.reasons.join(", ")})`,
        liq.approved ? "success" : "warning",
        liq,
        correlation_id,
      );
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

    if (qtyRemaining > 0 && input.side === "buy" && input.order_type === "market") {
      const liq = await this.liquidity.decide(qtyRemaining, {
        asset_id: eq.asset.id,
        side: "sell",
        sector: eq.sector,
      });
      await this.recordAudit(
        "liquidity",
        liq.approved
          ? `Liquidity Engine : Intervention vendeur (inventaire) approuvée`
          : `Liquidity Engine : Intervention refusée (${liq.reasons.join(", ")})`,
        liq.approved ? "success" : "warning",
        liq,
        correlation_id,
      );
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

    if (input.side === "buy") {
      const lockedTotal = input.qty * estimatePrice;
      const used = notionalFilled;
      const delta = lockedTotal - used;
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
      if (input.side === "buy") {
        const relock = qtyRemaining * restPrice;
        user.cash -= relock;
        user.cashLocked += relock;
      } else {
        const locked = user.holdingsLocked.get(eq.asset.id) ?? 0;
        user.holdingsLocked.set(eq.asset.id, locked + qtyRemaining);
      }
      status = qtyFilled > 0 ? "partial" : "resting";
      await this.recordAudit(
        "trading",
        `Ordre reposant au carnet : ${qtyRemaining} @ ${restPrice}`,
        "info",
        { order_id, qty_remaining: qtyRemaining, price: restPrice },
        correlation_id,
      );
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
    this.persistOrder(tracked);
    this.persistUser(user);

    await this.recordAudit(
      "portfolio",
      `Portefeuille mis à jour : cash=${user.cash}, ${eq.asset.symbol}=${user.holdings.get(eq.asset.id) ?? 0}`,
      "success",
      {
        cash_available: user.cash,
        holdings_qty: user.holdings.get(eq.asset.id) ?? 0,
      },
      correlation_id,
    );

    if (fills.length > 0) {
      const signals = await this.decision.evaluate({
        after_trade: true,
        symbol: eq.asset.symbol,
        fills: fills.length,
      });
      this.decisionSignals = signals.map((s) => ({ ...s }));
      for (const signal of signals) {
        await this.recordAudit(
          "decision",
          `Decision : ${signal.kind}${signal.subject?.asset_id ? ` (${signal.subject.asset_id})` : ""}`,
          "info",
          signal,
          correlation_id,
        );
      }
    }

    await sleep(15);

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
    this.monitoring.noteOrderRemoved(orderId);

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
    this.persistOrder(order);
    this.persistUser(user);
    await this.recordAudit(
      "trading",
      `Ordre annulé : ${order.symbol} ${order.order_id}`,
      "info",
      { order_id: orderId },
      order.correlation_id,
    );
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
        .map((e) => `${e.occurred_at.slice(11, 19)}  ${e.summary}`),
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
      this.decision,
      this.marketData,
    ] as const;
    const healthEntries = await Promise.all(
      engines.map(async (e) => [e.name, await e.health()] as const),
    );
    const engines_health = Object.fromEntries(
      healthEntries,
    ) as OpsSnapshot["engines_health"];

    return {
      ts: new Date().toISOString(),
      orders_per_min: this.orders.length,
      failures: {
        rejected_orders: this.rejectedOrders,
        failed_payments: this.paymentIntents.filter((p) => p.status === "failed")
          .length,
        failed_settlements: 0,
      },
      pending: {
        payments: this.paymentIntents.filter((p) => p.status === "pending")
          .length,
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

  getDecisionSignals(): DecisionSignalDto[] {
    return [...this.decisionSignals];
  }

  getTreasurySnapshot(): TreasurySnapshotDto {
    return this.treasury.snapshot();
  }

  getGovernance(): GovernanceProposalDto[] {
    return [...this.proposals];
  }

  async setLiquidityMode(mode: LiquidityMode): Promise<{ mode: LiquidityMode }> {
    this.requireStarted();
    this.liquidity.setMode(mode);
    await this.recordAudit(
      "system",
      `Mode liquidité → ${mode}`,
      "warning",
      { mode },
    );
    return { mode: this.liquidity.getMode() };
  }

  async propose(
    action: GovernanceAction | string,
    payload: Record<string, unknown> = {},
    proposedBy = "admin",
  ): Promise<GovernanceProposalDto> {
    this.requireStarted();
    const id = crypto.randomUUID();
    const proposal: GovernanceProposalDto = {
      id,
      action,
      payload,
      status: "pending",
      proposed_by: proposedBy,
      approved_by: null,
      created_at: new Date().toISOString(),
    };
    this.proposals.push(proposal);
    this.store?.insertProposal({
      id,
      action,
      payload,
      proposed_by: proposedBy,
      created_at: proposal.created_at,
    });
    await this.recordAudit(
      "audit",
      `Proposition : ${action}`,
      "info",
      { proposal_id: id, payload },
    );
    return proposal;
  }

  async approve(
    proposalId: string,
    actor = "admin",
  ): Promise<GovernanceProposalDto> {
    this.requireStarted();
    const proposal = this.proposals.find((p) => p.id === proposalId);
    if (!proposal) throw new Error("proposal_not_found");
    if (proposal.status !== "pending") throw new Error("proposal_not_pending");

    proposal.status = "approved";
    proposal.approved_by = actor;
    this.store?.setProposalStatus(proposalId, "approved", actor);

    if (proposal.action === "kill_switch") {
      const symbol =
        typeof proposal.payload.symbol === "string"
          ? proposal.payload.symbol
          : undefined;
      await this.adminKillSwitch(symbol);
    } else if (proposal.action === "set_liquidity_mode") {
      const mode = proposal.payload.mode;
      if (mode === "SGI_PARTNER" || mode === "AOTC_PRINCIPAL") {
        await this.setLiquidityMode(mode);
      }
    } else if (proposal.action === "change_exposure_limit") {
      await this.recordAudit(
        "audit",
        "Limite d'exposition mise à jour (sandbox)",
        "warning",
        proposal.payload,
      );
    }

    await this.recordAudit(
      "audit",
      `Proposition approuvée : ${proposal.action}`,
      "success",
      { proposal_id: proposalId, actor },
    );
    return proposal;
  }

  async createPartnerApiKey(name: string): Promise<ApiKeyDto> {
    this.requireStarted();
    const created = createApiKey();
    const dto: ApiKeyDto = {
      id: created.id,
      name: name.trim() || "partner-key",
      sgi_id: DEFAULT_SGI_ID,
      created_at: new Date().toISOString(),
      revoked_at: null,
      raw_key: created.raw_key,
    };
    this.apiKeysMeta.push({ ...dto, raw_key: undefined });
    this.apiKeyHashes.set(dto.id, created.key_hash);
    this.store?.insertApiKey({
      id: dto.id,
      key_hash: created.key_hash,
      name: dto.name,
      sgi_id: dto.sgi_id,
      created_at: dto.created_at,
    });
    await this.recordAudit("partner", `Clé API créée : ${dto.name}`, "success", {
      key_id: dto.id,
    });
    return dto;
  }

  revokeApiKey(id: string): ApiKeyDto {
    this.requireStarted();
    const meta = this.apiKeysMeta.find((k) => k.id === id);
    if (!meta) throw new Error("api_key_not_found");
    meta.revoked_at = new Date().toISOString();
    this.store?.revokeApiKey(id);
    return meta;
  }

  listApiKeys(): ApiKeyDto[] {
    this.requireStarted();
    return this.apiKeysMeta.map((k) => ({ ...k }));
  }

  authenticateApiKey(raw: string): ApiKeyDto | null {
    this.requireStarted();
    const hash = hashApiKey(raw);
    const row = this.store?.getApiKeyByHash(hash);
    if (row) {
      if (row.revoked_at) return null;
      return {
        id: row.id,
        name: row.name,
        sgi_id: row.sgi_id,
        created_at: row.created_at,
        revoked_at: row.revoked_at,
      };
    }
    for (const [id, h] of this.apiKeyHashes) {
      if (h !== hash) continue;
      const meta = this.apiKeysMeta.find((k) => k.id === id);
      if (!meta || meta.revoked_at) return null;
      return { ...meta };
    }
    return null;
  }

  listSgiClients(sgiId = DEFAULT_SGI_ID): SgiClientDto[] {
    this.requireStarted();
    const fromMem = [...this.usersById.values()]
      .filter((u) => u.sgiId === sgiId)
      .map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        kyc_status: u.kycStatus,
        cash: u.cash,
        mfa_enabled: u.mfaEnabled,
      }));
    if (fromMem.length > 0 || !this.store) return fromMem;
    return this.store.listUsers(sgiId).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      kyc_status: u.kyc_status,
      cash: u.cash,
      mfa_enabled: u.mfa_enabled,
    }));
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
    await this.recordAudit(
      "system",
      symbol
        ? `Kill-switch : ${symbol} suspendu`
        : "Kill-switch : marché suspendu",
      "warning",
      { suspended },
    );
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
    this.decision = new DecisionEngine();
    this.marketData = new MarketDataEngine();

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
      this.decision.start(ctx),
      this.marketData.start(ctx),
    ]);

    for (const eq of this.seed.equities) {
      this.liquidity.seedInventory(eq.asset.id, LIQUIDITY_SEED_QTY);
    }

    await this.seedMarketMakerBook();

    this.marketData.startSimulator(
      this.seed.equities.map((eq) => ({
        asset_id: eq.asset.id,
        instrument_id: eq.instrument.id,
        symbol: eq.asset.symbol,
        last: eq.reference_price,
        tick_size: eq.instrument.tick_size,
        exchange_id: eq.instrument.exchange_id,
      })),
      { intervalMs: 2_000, maxTickMove: 2 },
    );

    await this.recordAudit(
      "system",
      `Session sandbox démarrée — ${this.seed.equities.length} actions DEMO`,
      "info",
      { session_id: this.sessionId },
    );
  }

  private loadFromStore(): void {
    if (!this.store) return;
    for (const row of this.store.listUsers()) {
      const holdings = this.store.listHoldings(row.id);
      const user: UserState = {
        id: row.id,
        name: row.name,
        email: row.email,
        kycStatus: row.kyc_status,
        sgiId: row.sgi_id,
        cash: row.cash,
        cashLocked: row.cash_locked,
        holdings: new Map(holdings.map((h) => [h.asset_id, h.qty])),
        holdingsLocked: new Map(holdings.map((h) => [h.asset_id, h.locked])),
        mfaSecret: row.mfa_secret,
        mfaEnabled: row.mfa_enabled,
      };
      this.usersById.set(user.id, user);
    }
    // Session primaire = dernier utilisateur créé
    const users = [...this.usersById.values()];
    if (users.length > 0) {
      this.user = users[users.length - 1]!;
    }
    for (const o of this.store.listOrders()) {
      const payload = o.payload as TrackedOrder;
      if (payload?.order_id) this.orders.push(payload);
    }
    for (const t of this.store.listTrades()) {
      const payload = t.payload as TradeDto;
      if (payload?.trade_id) this.trades.push(payload);
    }
    for (const p of this.store.listPaymentIntents()) {
      this.paymentIntents.push(mapPayment(p));
    }
    for (const g of this.store.listProposals()) {
      this.proposals.push({
        id: g.id,
        action: g.action,
        payload: JSON.parse(g.payload_json) as Record<string, unknown>,
        status: g.status,
        proposed_by: g.proposed_by,
        approved_by: g.approved_by,
        created_at: g.created_at,
      });
    }
    for (const k of this.store.listApiKeys()) {
      this.apiKeysMeta.push({
        id: k.id,
        name: k.name,
        sgi_id: k.sgi_id,
        created_at: k.created_at,
        revoked_at: k.revoked_at,
      });
      this.apiKeyHashes.set(k.id, k.key_hash);
    }
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
    await this.recordAudit(
      "trading",
      `Trading Engine : Exécuté ${trade.qty} ${args.eq.asset.symbol} @ ${trade.price}${
        args.aotc_as_principal ? " (AOTC principal)" : ""
      }`,
      "success",
      trade,
      args.correlation_id,
    );

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
    this.store?.saveTrade(dto.trade_id, dto, user.id);
    return dto;
  }

  private async applyFillToUser(
    user: UserState,
    eq: SeededEquity,
    side: "buy" | "sell",
    qty: number,
    price: number,
  ): Promise<void> {
    if (side === "buy") {
      user.holdings.set(
        eq.asset.id,
        (user.holdings.get(eq.asset.id) ?? 0) + qty,
      );
      void price;
    } else {
      const have = user.holdings.get(eq.asset.id) ?? 0;
      user.holdings.set(eq.asset.id, Math.max(0, have - qty));
      user.cash += qty * price;
    }
  }

  private async stopEngines(): Promise<void> {
    this.marketData.stopSimulator();
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
      this.decision,
      this.marketData,
    ];
    await Promise.all(
      engines.filter(Boolean).map((e) => e.stop().catch(() => undefined)),
    );
  }

  private async recordAudit(
    actor: SimulationJournalActor,
    summary: string,
    severity: "info" | "success" | "warning" | "error",
    details?: unknown,
    correlation_id?: string,
  ): Promise<void> {
    const corr = correlation_id ?? this.sessionCorrelation;
    await this.publisher.record({
      correlation_id: corr,
      environment: ENV,
      actor,
      summary,
      severity,
      details: details as Record<string, unknown> | undefined,
    });
    this.store?.appendAudit({
      actor,
      summary,
      severity,
      correlation_id: corr,
      details,
    });
  }

  private persistUser(user: UserState): void {
    this.usersById.set(user.id, user);
    if (!this.store) return;
    this.store.upsertUser({
      id: user.id,
      name: user.name,
      email: user.email,
      kyc_status: user.kycStatus,
      sgi_id: user.sgiId,
      cash: user.cash,
      cash_locked: user.cashLocked,
      mfa_secret: user.mfaSecret,
      mfa_enabled: user.mfaEnabled,
    });
    const holdings = [...user.holdings.entries()].map(([asset_id, qty]) => {
      const eq = [...this.bySymbol.values()].find((e) => e.asset.id === asset_id);
      return {
        user_id: user.id,
        asset_id,
        symbol: eq?.asset.symbol ?? asset_id,
        qty,
        locked: user.holdingsLocked.get(asset_id) ?? 0,
      };
    });
    this.store.replaceHoldings(user.id, holdings);
  }

  private persistOrder(order: TrackedOrder): void {
    this.store?.saveOrder(order.order_id, order.user_id, order);
  }

  private patchIntent(intent: PaymentIntentDto): void {
    const idx = this.paymentIntents.findIndex((p) => p.id === intent.id);
    if (idx >= 0) this.paymentIntents[idx] = intent;
    else this.paymentIntents.push(intent);
    this.store?.updatePaymentIntentStatus(intent.id, intent.status);
  }

  private validWebhookSignature(intentId: string, signature: string): boolean {
    if (signature === "sandbox") return true;
    const expected = createHmac("sha256", WEBHOOK_SECRET)
      .update(intentId)
      .digest("hex");
    try {
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  private findUserByEmail(email: string): UserState | null {
    const key = email.trim().toLowerCase();
    for (const u of this.usersById.values()) {
      if (u.email === key) return u;
    }
    const row = this.store?.getUserByEmail(key);
    if (!row) return null;
    const holdings = this.store!.listHoldings(row.id);
    const user: UserState = {
      id: row.id,
      name: row.name,
      email: row.email,
      kycStatus: row.kyc_status,
      sgiId: row.sgi_id,
      cash: row.cash,
      cashLocked: row.cash_locked,
      holdings: new Map(holdings.map((h) => [h.asset_id, h.qty])),
      holdingsLocked: new Map(holdings.map((h) => [h.asset_id, h.locked])),
      mfaSecret: row.mfa_secret,
      mfaEnabled: row.mfa_enabled,
    };
    this.usersById.set(user.id, user);
    return user;
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
      mfa_enabled: u.mfaEnabled,
    };
  }

  private toMarketDto(eq: SeededEquity): MarketSymbolDto {
    const tick = this.marketData
      .getLastTicks()
      .find((t) => t.asset_id === eq.asset.id);
    const last =
      tick?.last ?? this.lastPrice.get(eq.asset.symbol) ?? eq.reference_price;
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

function mapPayment(row: {
  id: string;
  user_id: string;
  kind: "deposit" | "withdraw";
  amount: number;
  status: "pending" | "succeeded" | "failed";
  idempotency_key: string;
  created_at: string;
}): PaymentIntentDto {
  return { ...row };
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

export function createPlatform(opts: CreatePlatformOpts = {}): SandboxPlatform {
  return new SandboxPlatform(opts);
}
