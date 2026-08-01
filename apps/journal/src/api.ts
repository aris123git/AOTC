/** Client HTTP sandbox AOTC (Lot 2 — session token). */

const SESSION_KEY = "aotc_session";

let sessionToken: string | null =
  typeof localStorage !== "undefined"
    ? localStorage.getItem(SESSION_KEY)
    : null;

function saveSession(token: string | null) {
  sessionToken = token;
  if (typeof localStorage === "undefined") return;
  if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

export function getSessionToken(): string | null {
  return sessionToken;
}

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
  mfa_enabled?: boolean;
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

export type OtpRequestResult = {
  email: string;
  dev_code: string;
  expires_at: number;
};

export type AuthSessionResult = {
  session_token: string;
  user: User;
};

export type MfaSetupResult = {
  secret: string;
  otpauth_url: string;
};

export type PaymentIntent = {
  id: string;
  user_id: string;
  kind: "deposit" | "withdraw";
  amount: number;
  status: "pending" | "succeeded" | "failed";
  idempotency_key: string;
  created_at: string;
};

export type GovernanceAction =
  | "kill_switch"
  | "set_liquidity_mode"
  | "change_exposure_limit";

export type GovernanceProposal = {
  id: string;
  action: GovernanceAction | string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  proposed_by: string;
  approved_by?: string | null;
  created_at: string;
};

export type ApiKey = {
  id: string;
  name: string;
  sgi_id: string;
  created_at: string;
  revoked_at?: string | null;
  raw_key?: string;
};

export type DecisionSignal = {
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
};

export type TreasurySnapshot = {
  available: number;
  immobilized: number;
  credit_lines: Array<{ id: string; ceiling: number; drawn: number }>;
  capital_by_source: {
    aotc_own: number;
    coris: number;
    credit_line: number;
  };
  liquidity_revenue: number;
};

export type PriceTick = {
  asset_id: string;
  instrument_id?: string;
  exchange_id?: string;
  symbol?: string;
  last: number;
  mid: number;
  ts: string;
  source: string;
};

export type SgiClient = {
  id: string;
  name: string;
  email: string;
  kyc_status: "pending" | "approved";
  cash: number;
  mfa_enabled: boolean;
};

export type LiquidityMode = "SGI_PARTNER" | "AOTC_PRINCIPAL";

export type SessionDto = {
  session_id: string;
  environment: "sandbox";
  user: User | null;
  started_at: string;
  session_token?: string | null;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (sessionToken) headers["X-AOTC-Session"] = sessionToken;

  const res = await fetch(path, {
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof data?.error === "string" ? data.error : `HTTP ${res.status}`,
    );
  }
  return data as T;
}

function captureAuth(result: AuthSessionResult): AuthSessionResult {
  saveSession(result.session_token);
  return result;
}

export const api = {
  session: () => req<SessionDto>("/api/session"),
  reset: async () => {
    const result = await req<SessionDto>("/api/session/reset", {
      method: "POST",
    });
    saveSession(null);
    return result;
  },
  signup: (name: string, email: string) =>
    req<User>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email }),
    }),
  requestOtp: (email: string) =>
    req<OtpRequestResult>("/api/auth/otp/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyOtp: async (email: string, code: string) =>
    captureAuth(
      await req<AuthSessionResult>("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ email, code }),
      }),
    ),
  login: async (email: string, otp: string, mfa?: string) =>
    captureAuth(
      await req<AuthSessionResult>("/api/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify({ email, code: otp, mfa }),
      }),
    ),
  setupMfa: () =>
    req<MfaSetupResult>("/api/auth/mfa/setup", { method: "POST" }),
  verifyMfa: (code: string) =>
    req<User>("/api/auth/mfa/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
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
  createPaymentIntent: (amount: number, kind: "deposit" | "withdraw" = "deposit") =>
    req<PaymentIntent>("/api/payments/intent", {
      method: "POST",
      body: JSON.stringify({ amount, kind }),
    }),
  confirmWebhook: (intent_id: string, signature = "sandbox") =>
    req<PaymentIntent>("/api/payments/webhook", {
      method: "POST",
      body: JSON.stringify({ intent_id, signature }),
    }),
  treasury: () => req<TreasurySnapshot>("/api/treasury"),
  decisionSignals: () => req<DecisionSignal[]>("/api/decision/signals"),
  governance: () => req<GovernanceProposal[]>("/api/governance"),
  proposeGovernance: (action: string, payload: Record<string, unknown> = {}) =>
    req<GovernanceProposal>("/api/governance/propose", {
      method: "POST",
      body: JSON.stringify({ action, payload }),
    }),
  approveGovernance: (id: string) =>
    req<GovernanceProposal>(`/api/governance/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ actor: "admin" }),
    }),
  setLiquidityMode: (mode: LiquidityMode) =>
    req<{ mode: LiquidityMode }>("/api/admin/liquidity-mode", {
      method: "POST",
      body: JSON.stringify({ mode }),
    }),
  ticks: () => req<PriceTick[]>("/api/market/ticks"),
  partnerKeys: () => req<ApiKey[]>("/api/partner/keys"),
  createPartnerKey: (name: string) =>
    req<ApiKey>("/api/partner/keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  revokePartnerKey: (id: string) =>
    req<ApiKey>(`/api/partner/keys/${id}`, { method: "DELETE" }),
  sgiClients: () => req<SgiClient[]>("/api/sgi/clients"),
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
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (sessionToken) headers["X-AOTC-Session"] = sessionToken;
    const res = await fetch("/api/orders", {
      method: "POST",
      headers,
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
