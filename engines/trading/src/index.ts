/**
 * Trading Engine — Matching.
 *
 * RÈGLE #1 : jamais d'accès DB/Redis direct — uniquement MessageBus + contrats + OrderBookRepository.
 * RÈGLE #2 : ne connaît aucun autre moteur — publie/consomme des événements.
 * RÈGLE #5 : un leader par partition instrument/marché.
 */

import {
  BaseEngine,
  instrumentPartition,
  asInstrumentId,
  type EngineContext,
  type OrderBookRepository,
} from "@aotc/core";
import {
  TOPICS,
  createEnvelope,
  OrderAcceptedSchema,
  type OrderAccepted,
  type TradeExecuted,
  type OrderRested,
} from "@aotc/contracts";

export interface TradingEngineDeps {
  orderBook: OrderBookRepository;
}

export class TradingEngine extends BaseEngine {
  readonly name = "trading";
  private unsub: (() => Promise<void>) | null = null;
  private readonly orderBook: OrderBookRepository;

  constructor(deps: TradingEngineDeps) {
    super();
    this.orderBook = deps.orderBook;
  }

  protected async onStart(ctx: EngineContext): Promise<void> {
    const sub = await ctx.bus.subscribe<OrderAccepted>(
      TOPICS.ORDERS_ACCEPTED,
      (envelope) => this.onOrderAccepted(envelope.payload, envelope),
      {
        consumer_group: "trading",
        consumer_name: ctx.replica_id,
        leader_only: true,
      },
    );
    this.unsub = sub.unsubscribe;
  }

  protected async onStop(): Promise<void> {
    if (this.unsub) await this.unsub();
    this.unsub = null;
  }

  private async onOrderAccepted(
    raw: unknown,
    envelope: { correlation_id: string; environment: "sandbox" | "production"; message_id: string },
  ): Promise<void> {
    if (!this.ctx) return;
    const order = OrderAcceptedSchema.parse(raw);
    const partition = instrumentPartition(asInstrumentId(order.instrument_id));
    const isLeader = await this.becomeLeaderIfPossible(partition);
    if (!isLeader) return;

    // MVP squelette : repose l'ordre dans le book via le port repository (pas Redis direct).
    const price = order.price_limit ?? 0;
    await this.orderBook.upsertRestingOrder({
      instrument_id: asInstrumentId(order.instrument_id),
      order_id: order.order_id,
      side: order.side,
      price,
      qty: order.qty,
    });

    const rested: OrderRested = {
      order_id: order.order_id,
      instrument_id: order.instrument_id,
      side: order.side,
      price,
      qty_remaining: order.qty,
      rested_at: new Date().toISOString(),
    };

    await this.ctx.bus.publish(
      TOPICS.TRADING_RESTED,
      createEnvelope({
        type: "OrderRested",
        correlation_id: envelope.correlation_id,
        causation_id: envelope.message_id,
        environment: envelope.environment,
        payload: rested,
        tenant: { sgi_id: order.sgi_id },
      }),
      { partition_key: partition },
    );
  }

  /**
   * Point d'extension matching (Lot 1+).
   * Publie TradeExecuted — les autres moteurs le consomment (jamais d'appel direct).
   */
  async publishTrade(
    trade: TradeExecuted,
    correlationId: string,
    environment: "sandbox" | "production",
  ): Promise<void> {
    if (!this.ctx) throw new Error("TradingEngine not started");
    await this.ctx.bus.publish(
      TOPICS.TRADING_TRADE,
      createEnvelope({
        type: "TradeExecuted",
        correlation_id: correlationId,
        environment,
        payload: trade,
      }),
      { partition_key: trade.instrument_id },
    );
  }
}

export { InMemoryOrderBookRepository } from "./in-memory-order-book.js";
