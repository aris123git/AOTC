/** Identifiants de domaine (opaque strings — pas de UUID hardcodé côté métier). */

export type ExchangeId = string & { readonly __brand: "ExchangeId" };
export type MarketId = string & { readonly __brand: "MarketId" };
export type InstrumentId = string & { readonly __brand: "InstrumentId" };
export type AssetId = string & { readonly __brand: "AssetId" };
export type PartitionKey = string & { readonly __brand: "PartitionKey" };

export function asExchangeId(id: string): ExchangeId {
  return id as ExchangeId;
}
export function asMarketId(id: string): MarketId {
  return id as MarketId;
}
export function asInstrumentId(id: string): InstrumentId {
  return id as InstrumentId;
}
export function asAssetId(id: string): AssetId {
  return id as AssetId;
}

/**
 * Partition de marché pour le leadership HA.
 * Convention : `${exchangeId}:${marketId}` (ou plus fin : instrument).
 */
export function marketPartition(exchangeId: ExchangeId, marketId: MarketId): PartitionKey {
  return `${exchangeId}:${marketId}` as PartitionKey;
}

export function instrumentPartition(instrumentId: InstrumentId): PartitionKey {
  return `instrument:${instrumentId}` as PartitionKey;
}
