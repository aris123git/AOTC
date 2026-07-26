/** Client HTTP sandbox AOTC. */

export type MarketSymbol = {
  symbol: string;
  name: string;
  sector: string;
  last: number;
  change_bps: number;
  instrument_id: string;
  asset_id: string;
  status: "tradable" | "suspended" | "delisted";
};

export type InstrumentDetail = MarketSymbol & {
  exchange_id: string;
  market_id: string;
  tick_size: number;
  lot_size: number;
  reference_price: number;
  currency: string;
};

export type BookLevel = { price: number; qty: number; order_ids: string[] };
export type OrderBook = {
  symbol: string;
  instrument_id: string;
  bids: BookLevel[];
  asks: BookLevel[];
  updated_at: string;
};

export type Candle = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type User = {
  id: string;
  name: string;
  email: string;
  kyc_status: "pending" | "approved";
  sgi_id: string;
};

export type Portfolio = {
  user_id: string;
  cash_available: number;
  cash_locked: number;
  holdings: Array<{
    symbol: string;
    asset_id: string;
    qty: number;
    locked: number;
  }>;
};

export type Order = {
  order_id: string;
  client_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  order_type: "market" | "limit";
  qty: number;
  qty_filled: number;
  qty_remaining: number;
  price_limit?: number;
  avg_price?: number;
  status: string;
  aotc_as_principal?: boolean;
  created_at: string;
  rejection_reasons?: string[];
};

export type Trade = {
  trade_id: string;
  symbol: string;
  qty: number;
  price: number;
  side: "buy" | "sell";
  order_id: string;
  aotc_as_principal: boolean;
  liquidity_source: string;
  executed_at: string;
};

export type Settlement = {
  settlement_id: string;
  trade_id: string;
  symbol?: string;
  qty: number;
  amount: number;
  settlement_date: string;
  status: "instructed" | "confirmed";
  confirmed_at?: string;
};

export type EducationModule = {
  id: string;
  title: string;
  summary: string;
  body: string[];
};

export type OpsSnapshot = {
  ts: string;
  orders_per_min: number;
  failures: {
    rejected_orders: number;
    failed_payments: number;
    failed_settlements: number;
  };
  pending: { payments: number; settlements: number };
  risk_alerts_open: number;
  engines_health: Record<string, string>;
};

export type PartnerStats = {
  sgi_id: string;
  period: string;
  volume_brought: number;
  revenue_generated: number;
  commissions: number;
  market_share_bps: number;
  performance: { fill_rate: number; avg_execution_ms: number };
  updated_at: string;
};

export type Activity = {
  session_correlation_id: string;
  timeline: string[];
  entries: Array<{
    entry_id: string;
    occurred_at: string;
    actor: string;
    summary: string;
    severity: string;
  }>;
};

export type PlaceOrderResult = {
  order: Order;
  fills: Trade[];
  rejected: boolean;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
    );
  }
  return data as T;
}

export const api = {
  session: () => req<{ user: User | null }>("/api/session"),
  reset: () => req("/api/session/reset", { method: "POST" }),
  signup: (name: string, email: string) =>
    req<User>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email }),
    }),
  submitKyc: () => req<User>("/api/kyc/submit", { method: "POST" }),
  deposit: (amount: number) =>
    req<Portfolio>("/api/payments/deposit", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  withdraw: (amount: number) =>
    req<Portfolio>("/api/payments/withdraw", {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  market: () => req<MarketSymbol[]>("/api/market"),
  instrument: (symbol: string) =>
    req<InstrumentDetail>(`/api/market/${symbol}`),
  book: (symbol: string) => req<OrderBook>(`/api/market/${symbol}/book`),
  candles: (symbol: string) => req<Candle[]>(`/api/market/${symbol}/candles`),
  placeOrder: async (body: {
    symbol: string;
    side: "buy" | "sell";
    order_type: "market" | "limit";
    qty: number;
    price_limit?: number;
  }) => {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as PlaceOrderResult & {
      error?: string;
    };
    if (!res.ok && res.status !== 422) {
      throw new Error(
        typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
      );
    }
    return data as PlaceOrderResult;
  },
  orders: () => req<Order[]>("/api/orders"),
  cancelOrder: (id: string) =>
    req<Order>(`/api/orders/${id}`, { method: "DELETE" }),
  portfolio: () => req<Portfolio>("/api/portfolio"),
  trades: () => req<Trade[]>("/api/trades"),
  settlements: () => req<Settlement[]>("/api/settlements"),
  confirmSettlement: (id: string) =>
    req<Settlement>(`/api/settlements/${id}/confirm`, { method: "POST" }),
  activity: () => req<Activity>("/api/activity"),
  ops: () => req<OpsSnapshot>("/api/admin/ops"),
  killSwitch: (symbol?: string) =>
    req<{ suspended: string[] }>("/api/admin/kill-switch", {
      method: "POST",
      body: JSON.stringify({ symbol }),
    }),
  partner: () => req<PartnerStats>("/api/partner/stats"),
  education: () => req<EducationModule[]>("/api/education"),
};

/** Montants sandbox : entiers (minor units) → XOF affichables. */
export function xof(minor: number): string {
  return (minor / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function bpsLabel(bps: number): string {
  const pct = (bps / 100).toFixed(2);
  return `${bps >= 0 ? "+" : ""}${pct} %`;
}
