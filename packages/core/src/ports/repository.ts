/**
 * Ports Repository — RÈGLE #1.
 * Le Matching Engine (et tout moteur) n'accède à la persistence
 * que via ces ports. Les adapters (Postgres, Redis, …) sont hors moteurs.
 */

import type { Asset } from "../domain/asset.js";
import type { Exchange } from "../domain/exchange.js";
import type { Instrument } from "../domain/instrument.js";
import type { Market } from "../domain/market.js";
import type {
  AssetId,
  ExchangeId,
  InstrumentId,
  MarketId,
} from "../domain/ids.js";

export interface ExchangeRepository {
  getById(id: ExchangeId): Promise<Exchange | null>;
  getByCode(code: string): Promise<Exchange | null>;
  listActive(): Promise<Exchange[]>;
}

export interface MarketRepository {
  getById(id: MarketId): Promise<Market | null>;
  listByExchange(exchangeId: ExchangeId): Promise<Market[]>;
}

export interface AssetRepository {
  getById(id: AssetId): Promise<Asset | null>;
  getBySymbol(symbol: string): Promise<Asset | null>;
}

export interface InstrumentRepository {
  getById(id: InstrumentId): Promise<Instrument | null>;
  listByMarket(marketId: MarketId): Promise<Instrument[]>;
  getByLocalSymbol(
    exchangeId: ExchangeId,
    localSymbol: string,
  ): Promise<Instrument | null>;
}

/** Niveau carnet pour ports matching (pas de structure Redis exposée). */
export interface BookLevel {
  price: number;
  qty: number;
  order_ids: string[];
}

export interface OrderBookSnapshot {
  instrument_id: InstrumentId;
  bids: BookLevel[];
  asks: BookLevel[];
  updated_at: string;
}

/**
 * Port carnet d'ordres — utilisé exclusivement par le Trading Engine.
 * L'implémentation peut être Redis, mémoire, etc. : le moteur s'en fiche.
 */
export interface OrderBookRepository {
  getSnapshot(instrumentId: InstrumentId): Promise<OrderBookSnapshot>;
  upsertRestingOrder(input: {
    instrument_id: InstrumentId;
    order_id: string;
    side: "buy" | "sell";
    price: number;
    qty: number;
  }): Promise<void>;
  removeOrder(instrumentId: InstrumentId, orderId: string): Promise<void>;
  reduceOrderQty(
    instrumentId: InstrumentId,
    orderId: string,
    qty: number,
  ): Promise<void>;
}
