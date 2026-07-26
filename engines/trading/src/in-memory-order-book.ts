import type {
  InstrumentId,
  OrderBookRepository,
  OrderBookSnapshot,
} from "@aotc/core";

export type RestingOrderDetail = {
  instrument_id: InstrumentId;
  order_id: string;
  side: "buy" | "sell";
  price: number;
  qty: number;
  accepted_at: string;
  user_id?: string;
  sgi_id?: string;
};

/**
 * Adapter in-memory du carnet — hors « logique matching ».
 * Remplacé plus tard par Redis sans toucher TradingEngine (Règle #1).
 */
export class InMemoryOrderBookRepository implements OrderBookRepository {
  private books = new Map<string, OrderBookSnapshot>();
  private orders = new Map<string, RestingOrderDetail>();

  async getSnapshot(instrumentId: InstrumentId): Promise<OrderBookSnapshot> {
    return (
      this.books.get(instrumentId) ?? {
        instrument_id: instrumentId,
        bids: [],
        asks: [],
        updated_at: new Date().toISOString(),
      }
    );
  }

  async listOrders(instrumentId: InstrumentId): Promise<RestingOrderDetail[]> {
    return [...this.orders.values()]
      .filter((o) => o.instrument_id === instrumentId && o.qty > 0)
      .sort((a, b) => a.accepted_at.localeCompare(b.accepted_at));
  }

  async getOrder(orderId: string): Promise<RestingOrderDetail | null> {
    return this.orders.get(orderId) ?? null;
  }

  async upsertRestingOrder(input: {
    instrument_id: InstrumentId;
    order_id: string;
    side: "buy" | "sell";
    price: number;
    qty: number;
    user_id?: string;
    sgi_id?: string;
    accepted_at?: string;
  }): Promise<void> {
    const existing = this.orders.get(input.order_id);
    const detail: RestingOrderDetail = {
      instrument_id: input.instrument_id,
      order_id: input.order_id,
      side: input.side,
      price: input.price,
      qty: input.qty,
      accepted_at: existing?.accepted_at ?? input.accepted_at ?? new Date().toISOString(),
      user_id: input.user_id ?? existing?.user_id,
      sgi_id: input.sgi_id ?? existing?.sgi_id,
    };
    this.orders.set(input.order_id, detail);
    this.rebuildBook(input.instrument_id);
  }

  async removeOrder(instrumentId: InstrumentId, orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (order && order.instrument_id === instrumentId) {
      this.orders.delete(orderId);
    } else if (order) {
      this.orders.delete(orderId);
    } else {
      // compat : retirer de l'ancien book si présent sans Map orders
    }
    this.rebuildBook(instrumentId);
  }

  async reduceOrderQty(
    instrumentId: InstrumentId,
    orderId: string,
    qty: number,
  ): Promise<void> {
    const order = this.orders.get(orderId);
    if (!order || order.instrument_id !== instrumentId) {
      this.rebuildBook(instrumentId);
      return;
    }
    order.qty = Math.max(0, order.qty - qty);
    if (order.qty === 0) {
      this.orders.delete(orderId);
    } else {
      this.orders.set(orderId, order);
    }
    this.rebuildBook(instrumentId);
  }

  clear(): void {
    this.books.clear();
    this.orders.clear();
  }

  private rebuildBook(instrumentId: InstrumentId): void {
    const bidsMap = new Map<number, { price: number; qty: number; order_ids: string[] }>();
    const asksMap = new Map<number, { price: number; qty: number; order_ids: string[] }>();

    for (const order of this.orders.values()) {
      if (order.instrument_id !== instrumentId || order.qty <= 0) continue;
      const map = order.side === "buy" ? bidsMap : asksMap;
      const level = map.get(order.price);
      if (level) {
        level.qty += order.qty;
        level.order_ids.push(order.order_id);
      } else {
        map.set(order.price, {
          price: order.price,
          qty: order.qty,
          order_ids: [order.order_id],
        });
      }
    }

    const bids = [...bidsMap.values()].sort((a, b) => b.price - a.price);
    const asks = [...asksMap.values()].sort((a, b) => a.price - b.price);

    this.books.set(instrumentId, {
      instrument_id: instrumentId,
      bids,
      asks,
      updated_at: new Date().toISOString(),
    });
  }
}
