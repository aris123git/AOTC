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

export type LiquidityMode = "SGI_PARTNER" | "AOTC_PRINCIPAL";

export type GovernanceAction =
  | "kill_switch"
  | "set_liquidity_mode"
  | "change_exposure_limit";

export type PaymentKind = "deposit" | "withdraw";
export type PaymentStatus = "pending" | "succeeded" | "failed";

export interface SignupInput {
  name: string;
  email: string;
}

export interface CreatePlatformOpts {
  /** Active la persistance SQLite sur ce chemin. */
  dbPath?: string;
}

export interface UserDto {
  id: string;
  name: string;
  email: string;
  kyc_status: KycStatus;
  sgi_id: string;
  mfa_enabled?: boolean;
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
  session_token?: string | null;
}

export interface PlaceOrderResult {
  order: OrderDto;
  fills: TradeDto[];
  rejected: boolean;
}

export interface OtpRequestResult {
  email: string;
  /** Code exposé uniquement en sandbox pour les démos / tests. */
  dev_code: string;
  expires_at: number;
}

export interface AuthSessionResult {
  session_token: string;
  user: UserDto;
}

export interface MfaSetupResult {
  secret: string;
  otpauth_url: string;
}

export interface PaymentIntentDto {
  id: string;
  user_id: string;
  kind: PaymentKind;
  amount: number;
  status: PaymentStatus;
  idempotency_key: string;
  created_at: string;
}

export interface GovernanceProposalDto {
  id: string;
  action: GovernanceAction | string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  proposed_by: string;
  approved_by?: string | null;
  created_at: string;
}

export interface ApiKeyDto {
  id: string;
  name: string;
  sgi_id: string;
  created_at: string;
  revoked_at?: string | null;
  /** Présent uniquement à la création. */
  raw_key?: string;
}

export interface DecisionSignalDto {
  signal_id: string;
  kind: string;
  subject?: {
    asset_id?: string;
    instrument_id?: string;
    sgi_id?: string;
    user_id?: string;
  };
  score?: number;
  payload: Record<string, unknown>;
  produced_at: string;
  actionable: boolean;
}

export interface TreasurySnapshotDto {
  available: number;
  immobilized: number;
  credit_lines: Array<{ id: string; ceiling: number; drawn: number }>;
  capital_by_source: {
    aotc_own: number;
    coris: number;
    credit_line: number;
  };
  liquidity_revenue: number;
}

export interface PriceTickDto {
  asset_id: string;
  instrument_id?: string;
  exchange_id?: string;
  symbol?: string;
  last: number;
  mid: number;
  ts: string;
  source: string;
}

export interface SgiClientDto {
  id: string;
  name: string;
  email: string;
  kyc_status: KycStatus;
  cash: number;
  mfa_enabled: boolean;
}
