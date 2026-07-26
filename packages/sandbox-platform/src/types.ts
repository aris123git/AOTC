/** DTOs publics de l'API sandbox AOTC. */

export type KycStatus = "pending" | "approved";

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type OrderStatus =
  | "rejected"
  | "accepted"
  | "partial"
  | "filled"
  | "resting"
  | "cancelled";

export interface SignupInput {
  name: string;
  email: string;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  kyc_status: KycStatus;
  sgi_id: string;
}

export interface PlaceOrderInput {
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  qty: number;
  price_limit?: number;
}

export interface MarketSymbolDto {
  symbol: string;
  name: string;
  sector: string;
  last: number;
  change_bps: number;
  instrument_id: string;
  asset_id: string;
  status: "tradable" | "suspended" | "delisted";
}

export interface InstrumentDetailDto extends MarketSymbolDto {
  exchange_id: string;
  market_id: string;
  tick_size: number;
  lot_size: number;
  reference_price: number;
  currency: string;
}

export interface BookLevelDto {
  price: number;
  qty: number;
  order_ids: string[];
}

export interface OrderBookDto {
  symbol: string;
  instrument_id: string;
  bids: BookLevelDto[];
  asks: BookLevelDto[];
  updated_at: string;
}

export interface CandleDto {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PortfolioDto {
  user_id: string;
  cash_available: number;
  cash_locked: number;
  holdings: Array<{
    symbol: string;
    asset_id: string;
    qty: number;
    locked: number;
  }>;
}

export interface OrderDto {
  order_id: string;
  client_order_id: string;
  symbol: string;
  side: OrderSide;
  order_type: OrderType;
  qty: number;
  qty_filled: number;
  qty_remaining: number;
  price_limit?: number;
  avg_price?: number;
  status: OrderStatus;
  aotc_as_principal?: boolean;
  created_at: string;
  rejection_reasons?: string[];
}

export interface TradeDto {
  trade_id: string;
  symbol: string;
  qty: number;
  price: number;
  side: OrderSide;
  order_id: string;
  aotc_as_principal: boolean;
  liquidity_source: string;
  executed_at: string;
}

export interface SettlementDto {
  settlement_id: string;
  trade_id: string;
  symbol?: string;
  qty: number;
  amount: number;
  settlement_date: string;
  status: "instructed" | "confirmed";
  confirmed_at?: string;
}

export interface EducationModuleDto {
  id: string;
  title: string;
  summary: string;
  body: string[];
}

export interface SessionDto {
  session_id: string;
  environment: "sandbox";
  user: UserDto | null;
  started_at: string;
}

export interface PlaceOrderResult {
  order: OrderDto;
  fills: TradeDto[];
  rejected: boolean;
}
