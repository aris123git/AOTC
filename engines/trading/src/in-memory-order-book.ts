import type {
  InstrumentId,
  OrderBookRepository,
  OrderBookSnapshot,
} from "@aotc/core";

/**
 * Adapter in-memory du carnet — hors « logique matching ».
 * Remplacé plus tard par Redis sans toucher TradingEngine (Règle #1).
 */
export class InMemoryOrderBookRepository implements OrderBookRepository {
  private books = new Map<string, OrderBookSnapshot>();

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

  async upsertRestingOrder(input: {
    instrument_id: InstrumentId;
    order_id: string;
    side: "buy" | "sell";
    price: number;
    qty: number;
  }): Promise<void> {
    const snap = await this.getSnapshot(input.instrument_id);
    const side = input.side === "buy" ? snap.bids : snap.asks;
    const level = side.find((l) => l.price === input.price);
    if (level) {
      level.qty += input.qty;
      level.order_ids.push(input.order_id);
    } else {
      side.push({
        price: input.price,
        qty: input.qty,
        order_ids: [input.order_id],
      });
    }
    if (input.side === "buy") {
      snap.bids.sort((a, b) => b.price - a.price);
    } else {
      snap.asks.sort((a, b) => a.price - b.price);
    }
    snap.updated_at = new Date().toISOString();
    this.books.set(input.instrument_id, snap);
  }

  async removeOrder(instrumentId: InstrumentId, orderId: string): Promise<void> {
    const snap = await this.getSnapshot(instrumentId);
    for (const side of [snap.bids, snap.asks]) {
      for (const level of side) {
        const idx = level.order_ids.indexOf(orderId);
        if (idx >= 0) {
          level.order_ids.splice(idx, 1);
          // qty recalculée naïvement ; matching fin viendra plus tard
          if (level.order_ids.length === 0) level.qty = 0;
        }
      }
    }
    snap.bids = snap.bids.filter((l) => l.qty > 0);
    snap.asks = snap.asks.filter((l) => l.qty > 0);
    snap.updated_at = new Date().toISOString();
    this.books.set(instrumentId, snap);
  }

  async reduceOrderQty(
    instrumentId: InstrumentId,
    orderId: string,
    qty: number,
  ): Promise<void> {
    const snap = await this.getSnapshot(instrumentId);
    for (const side of [snap.bids, snap.asks]) {
      for (const level of side) {
        if (level.order_ids.includes(orderId)) {
          level.qty = Math.max(0, level.qty - qty);
        }
      }
    }
    snap.bids = snap.bids.filter((l) => l.qty > 0);
    snap.asks = snap.asks.filter((l) => l.qty > 0);
    snap.updated_at = new Date().toISOString();
    this.books.set(instrumentId, snap);
  }
}
