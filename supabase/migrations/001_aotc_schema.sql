-- =============================================================================
-- AOTC — Schéma Supabase (Postgres) + RLS multi-tenant SGI
-- Coller dans : Supabase → SQL Editor → Run
-- Montants : entiers minor units XOF (BIGINT)
-- Auth : profiles.id = auth.users.id
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'investor', 'sgi_agent', 'aotc_admin', 'super_admin', 'system'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.kyc_status AS ENUM (
    'pending', 'submitted', 'approved', 'rejected', 'suspended'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_class AS ENUM (
    'equity', 'bond', 'govt_bond', 'sukuk', 'mutual_fund', 'etf'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.asset_status AS ENUM (
    'listed', 'suspended', 'delisted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.instrument_status AS ENUM (
    'tradable', 'suspended', 'delisted'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.order_side AS ENUM ('buy', 'sell');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.order_type AS ENUM ('market', 'limit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.tif AS ENUM ('gtc', 'day', 'ioc', 'fok');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.order_status AS ENUM (
    'rejected', 'accepted', 'partial', 'filled', 'resting', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.route_type AS ENUM (
    'internal_book', 'sgi_counterparty', 'aotc_liquidity', 'external_venue'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.settlement_status AS ENUM (
    'instructed', 'confirmed', 'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_kind AS ENUM ('deposit', 'withdraw');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.payment_status AS ENUM ('pending', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.liquidity_mode AS ENUM ('SGI_PARTNER', 'AOTC_PRINCIPAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.proposal_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.price_source AS ENUM ('exchange_official', 'aotc_computed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.env_type AS ENUM ('sandbox', 'production');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- -----------------------------------------------------------------------------
-- Helpers RLS
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_profile_id()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_sgi_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sgi_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_aotc_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role IN ('aotc_admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_sgi_agent()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'sgi_agent'
  );
$$;

-- -----------------------------------------------------------------------------
-- 1. SGI & profils
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sgis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  commission_bps  INTEGER NOT NULL DEFAULT 10 CHECK (commission_bps >= 0),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  sgi_id          UUID NOT NULL REFERENCES public.sgis(id),
  role            public.user_role NOT NULL DEFAULT 'investor',
  kyc_status      public.kyc_status NOT NULL DEFAULT 'pending',
  mfa_enabled     BOOLEAN NOT NULL DEFAULT false,
  phone           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_sgi ON public.profiles(sgi_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

CREATE TABLE IF NOT EXISTS public.kyc_documents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL, -- id_card, passport, proof_address…
  storage_path    TEXT NOT NULL, -- bucket KYC
  status          public.kyc_status NOT NULL DEFAULT 'submitted',
  reviewed_by     UUID REFERENCES public.profiles(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kyc_user ON public.kyc_documents(user_id);

-- -----------------------------------------------------------------------------
-- 2. Référentiel marché (multibourse)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.exchanges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'XOF',
  timezone        TEXT NOT NULL DEFAULT 'Africa/Abidjan',
  status          TEXT NOT NULL DEFAULT 'active',
  session_open    TIME NOT NULL DEFAULT '09:00',
  session_close   TIME NOT NULL DEFAULT '15:30',
  settlement_cycle_days INTEGER NOT NULL DEFAULT 3,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.markets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exchange_id     UUID NOT NULL REFERENCES public.exchanges(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  segment         TEXT NOT NULL DEFAULT 'equity',
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'halted', 'closed')),
  UNIQUE (exchange_id, code)
);

CREATE TABLE IF NOT EXISTS public.assets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol          TEXT NOT NULL UNIQUE,
  isin            TEXT,
  asset_class     public.asset_class NOT NULL DEFAULT 'equity',
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'XOF',
  status          public.asset_status NOT NULL DEFAULT 'listed',
  tick_size       BIGINT NOT NULL DEFAULT 5,
  lot_size        INTEGER NOT NULL DEFAULT 1,
  sector          TEXT,
  attrs           JSONB NOT NULL DEFAULT '{}'::jsonb, -- bond/sukuk/fund specifics
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.instruments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES public.assets(id),
  exchange_id     UUID NOT NULL REFERENCES public.exchanges(id),
  market_id       UUID NOT NULL REFERENCES public.markets(id),
  local_symbol    TEXT NOT NULL,
  tick_size       BIGINT NOT NULL DEFAULT 5,
  lot_size        INTEGER NOT NULL DEFAULT 1,
  status          public.instrument_status NOT NULL DEFAULT 'tradable',
  UNIQUE (exchange_id, local_symbol)
);

CREATE INDEX IF NOT EXISTS idx_instruments_asset ON public.instruments(asset_id);

CREATE TABLE IF NOT EXISTS public.market_prices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id   UUID NOT NULL REFERENCES public.instruments(id) ON DELETE CASCADE,
  last            BIGINT NOT NULL,
  mid             BIGINT,
  source          public.price_source NOT NULL,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_prices_instr_ts
  ON public.market_prices(instrument_id, ts DESC);

CREATE TABLE IF NOT EXISTS public.candles (
  instrument_id   UUID NOT NULL REFERENCES public.instruments(id) ON DELETE CASCADE,
  timeframe       TEXT NOT NULL CHECK (timeframe IN ('1m', '1h', '1d')),
  ts              TIMESTAMPTZ NOT NULL,
  o               BIGINT NOT NULL,
  h               BIGINT NOT NULL,
  l               BIGINT NOT NULL,
  c               BIGINT NOT NULL,
  v               BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (instrument_id, timeframe, ts)
);

CREATE TABLE IF NOT EXISTS public.corporate_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES public.assets(id),
  kind            TEXT NOT NULL, -- dividend, split, rights_issue, coupon, redemption
  ex_date         DATE NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- 3. Cash, holdings, ledger
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_accounts (
  user_id         UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  available       BIGINT NOT NULL DEFAULT 0 CHECK (available >= 0),
  locked          BIGINT NOT NULL DEFAULT 0 CHECK (locked >= 0),
  currency        TEXT NOT NULL DEFAULT 'XOF',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.holdings (
  user_id         UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  asset_id        UUID NOT NULL REFERENCES public.assets(id),
  qty             BIGINT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  locked          BIGINT NOT NULL DEFAULT 0 CHECK (locked >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, asset_id),
  CHECK (locked <= qty)
);

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES public.profiles(id),
  entry_type      TEXT NOT NULL, -- deposit, withdraw, trade_debit, trade_credit, lock, unlock, settle…
  amount          BIGINT NOT NULL, -- signed minor units (cash) OR qty for securities
  asset_id        UUID REFERENCES public.assets(id), -- null = cash
  currency        TEXT NOT NULL DEFAULT 'XOF',
  correlation_id  UUID,
  ref_type        TEXT, -- order, trade, payment_intent, settlement
  ref_id          UUID,
  memo            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_user_ts ON public.ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_corr ON public.ledger_entries(correlation_id);

CREATE TABLE IF NOT EXISTS public.payment_intents (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
  kind            public.payment_kind NOT NULL,
  amount          BIGINT NOT NULL CHECK (amount > 0),
  status          public.payment_status NOT NULL DEFAULT 'pending',
  idempotency_key TEXT NOT NULL UNIQUE,
  provider        TEXT NOT NULL DEFAULT 'sandbox', -- orange, moov, wave, sandbox
  provider_ref    TEXT,
  environment     public.env_type NOT NULL DEFAULT 'sandbox',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON public.payment_intents(user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Orders, trades, settlements
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_order_id TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES public.profiles(id),
  sgi_id          UUID NOT NULL REFERENCES public.sgis(id),
  asset_id        UUID NOT NULL REFERENCES public.assets(id),
  instrument_id   UUID NOT NULL REFERENCES public.instruments(id),
  exchange_id     UUID NOT NULL REFERENCES public.exchanges(id),
  market_id       UUID NOT NULL REFERENCES public.markets(id),
  side            public.order_side NOT NULL,
  order_type      public.order_type NOT NULL,
  tif             public.tif NOT NULL DEFAULT 'day',
  qty             BIGINT NOT NULL CHECK (qty > 0),
  qty_filled      BIGINT NOT NULL DEFAULT 0 CHECK (qty_filled >= 0),
  qty_remaining   BIGINT NOT NULL DEFAULT 0,
  price_limit     BIGINT,
  avg_price       BIGINT,
  status          public.order_status NOT NULL DEFAULT 'accepted',
  route           public.route_type,
  reservation_ref UUID,
  aotc_as_principal BOOLEAN NOT NULL DEFAULT false,
  rejection_reasons TEXT[] NOT NULL DEFAULT '{}',
  correlation_id  UUID NOT NULL,
  environment     public.env_type NOT NULL DEFAULT 'sandbox',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_order_id)
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_sgi ON public.orders(sgi_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_corr ON public.orders(correlation_id);
CREATE INDEX IF NOT EXISTS idx_orders_instr_status ON public.orders(instrument_id, status);

CREATE TABLE IF NOT EXISTS public.trades (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id        UUID NOT NULL REFERENCES public.assets(id),
  instrument_id   UUID NOT NULL REFERENCES public.instruments(id),
  exchange_id     UUID NOT NULL REFERENCES public.exchanges(id),
  market_id       UUID NOT NULL REFERENCES public.markets(id),
  buy_order_id    UUID NOT NULL REFERENCES public.orders(id),
  sell_order_id   UUID, -- peut être inventaire liquidité (nullable ou order synthétique)
  buyer_user_id   UUID REFERENCES public.profiles(id),
  seller_user_id  UUID REFERENCES public.profiles(id),
  buyer_sgi_id    UUID NOT NULL REFERENCES public.sgis(id),
  seller_sgi_id   UUID NOT NULL REFERENCES public.sgis(id),
  qty             BIGINT NOT NULL CHECK (qty > 0),
  price           BIGINT NOT NULL CHECK (price > 0),
  aotc_as_principal BOOLEAN NOT NULL DEFAULT false,
  liquidity_source public.route_type NOT NULL,
  correlation_id  UUID NOT NULL,
  environment     public.env_type NOT NULL DEFAULT 'sandbox',
  executed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trades_exec ON public.trades(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_corr ON public.trades(correlation_id);

CREATE TABLE IF NOT EXISTS public.settlements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id        UUID NOT NULL UNIQUE REFERENCES public.trades(id),
  asset_id        UUID NOT NULL REFERENCES public.assets(id),
  instrument_id   UUID REFERENCES public.instruments(id),
  qty             BIGINT NOT NULL,
  amount          BIGINT NOT NULL,
  buyer_sgi_id    UUID NOT NULL REFERENCES public.sgis(id),
  seller_sgi_id   UUID NOT NULL REFERENCES public.sgis(id),
  settlement_date DATE NOT NULL,
  status          public.settlement_status NOT NULL DEFAULT 'instructed',
  failure_reason  TEXT,
  confirmed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_status ON public.settlements(status, settlement_date);

-- -----------------------------------------------------------------------------
-- 5. Liquidité & Treasury
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.liquidity_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode            public.liquidity_mode NOT NULL DEFAULT 'SGI_PARTNER',
  partner_sgi_id  UUID REFERENCES public.sgis(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      UUID REFERENCES public.profiles(id)
);

CREATE TABLE IF NOT EXISTS public.liquidity_inventory (
  asset_id        UUID PRIMARY KEY REFERENCES public.assets(id),
  qty             BIGINT NOT NULL DEFAULT 0,
  avg_cost        BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.liquidity_limits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL CHECK (scope IN ('asset', 'sgi', 'sector', 'global')),
  scope_ref       TEXT, -- asset_id / sgi_id / sector name / null for global
  max_qty         BIGINT,
  max_notional    BIGINT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (scope, scope_ref)
);

CREATE TABLE IF NOT EXISTS public.treasury_positions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT NOT NULL CHECK (source IN ('aotc_own', 'coris', 'credit_line')),
  label           TEXT NOT NULL,
  available       BIGINT NOT NULL DEFAULT 0,
  immobilized     BIGINT NOT NULL DEFAULT 0,
  ceiling         BIGINT, -- pour credit_line
  drawn           BIGINT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.treasury_reservations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose         TEXT NOT NULL, -- order_cash_lock, liquidity_intervention
  amount          BIGINT NOT NULL CHECK (amount > 0),
  source          TEXT NOT NULL CHECK (source IN ('aotc_own', 'coris', 'credit_line')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'settled')),
  correlation_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at     TIMESTAMPTZ
);

-- -----------------------------------------------------------------------------
-- 6. Partenaires / API
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sgi_id          UUID NOT NULL REFERENCES public.sgis(id),
  name            TEXT NOT NULL,
  key_hash        TEXT NOT NULL UNIQUE, -- sha256, jamais la clé brute
  key_prefix      TEXT NOT NULL,       -- aotc_sk_xxxx pour affichage
  revoked_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_sgi ON public.api_keys(sgi_id);

CREATE TABLE IF NOT EXISTS public.partner_stats_daily (
  sgi_id          UUID NOT NULL REFERENCES public.sgis(id),
  day             DATE NOT NULL,
  volume_brought  BIGINT NOT NULL DEFAULT 0,
  revenue_generated BIGINT NOT NULL DEFAULT 0,
  commissions     BIGINT NOT NULL DEFAULT 0,
  fills           INTEGER NOT NULL DEFAULT 0,
  rejects         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sgi_id, day)
);

-- -----------------------------------------------------------------------------
-- 7. Gouvernance, alertes, audit, decision
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.governance_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action          TEXT NOT NULL, -- kill_switch, set_liquidity_mode, change_exposure_limit
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          public.proposal_status NOT NULL DEFAULT 'pending',
  proposed_by     UUID NOT NULL REFERENCES public.profiles(id),
  approved_by     UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.monitoring_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern         TEXT NOT NULL, -- unusual_volume, wash_trading, spoofing, layering
  severity        TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  asset_id        UUID REFERENCES public.assets(id),
  sgi_id          UUID REFERENCES public.sgis(id),
  user_id         UUID REFERENCES public.profiles(id),
  evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ack', 'closed')),
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON public.monitoring_alerts(status, detected_at DESC);

CREATE TABLE IF NOT EXISTS public.decision_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL, -- recommendation, liquidity_forecast, anomaly, spread_optimization
  subject         JSONB NOT NULL DEFAULT '{}'::jsonb,
  score           NUMERIC,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  actionable      BOOLEAN NOT NULL DEFAULT false,
  produced_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor           TEXT NOT NULL, -- auth, kyc, risk, trading, system, user:<uuid>
  actor_user_id   UUID REFERENCES public.profiles(id),
  summary         TEXT NOT NULL,
  severity        TEXT NOT NULL DEFAULT 'info',
  correlation_id  UUID,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  environment     public.env_type NOT NULL DEFAULT 'sandbox'
);

CREATE INDEX IF NOT EXISTS idx_audit_ts ON public.audit_logs(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_corr ON public.audit_logs(correlation_id);

-- Immutabilité audit (pas d'UPDATE/DELETE pour non-staff)
CREATE OR REPLACE FUNCTION public.prevent_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_no_update ON public.audit_logs;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_mutation();

-- -----------------------------------------------------------------------------
-- Trigger : créer profile + cash_account à l'inscription (optionnel)
-- Adapter si tu gères le profile côté app après signup.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sgi UUID;
BEGIN
  SELECT id INTO v_sgi FROM public.sgis WHERE code = 'SGI_DEMO' LIMIT 1;
  IF v_sgi IS NULL THEN
    RETURN NEW; -- seeds pas encore appliqués
  END IF;

  INSERT INTO public.profiles (id, email, full_name, sgi_id, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    v_sgi,
    'investor'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.cash_accounts (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
ALTER TABLE public.sgis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kyc_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchanges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.corporate_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidity_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidity_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.liquidity_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_stats_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.governance_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitoring_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Lecture marché : authentifié
CREATE POLICY market_read ON public.exchanges FOR SELECT TO authenticated USING (true);
CREATE POLICY market_read ON public.markets FOR SELECT TO authenticated USING (true);
CREATE POLICY market_read ON public.assets FOR SELECT TO authenticated USING (true);
CREATE POLICY market_read ON public.instruments FOR SELECT TO authenticated USING (true);
CREATE POLICY market_read ON public.market_prices FOR SELECT TO authenticated USING (true);
CREATE POLICY market_read ON public.candles FOR SELECT TO authenticated USING (true);
CREATE POLICY market_read ON public.corporate_actions FOR SELECT TO authenticated USING (true);

-- SGI : lecture pour authentifiés
CREATE POLICY sgis_read ON public.sgis FOR SELECT TO authenticated USING (true);

-- Profiles
CREATE POLICY profiles_self ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.is_aotc_staff()
    OR (public.is_sgi_agent() AND sgi_id = public.current_sgi_id())
  );

CREATE POLICY profiles_self_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.is_aotc_staff())
  WITH CHECK (id = auth.uid() OR public.is_aotc_staff());

-- KYC
CREATE POLICY kyc_own ON public.kyc_documents
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_aotc_staff()
    OR (
      public.is_sgi_agent()
      AND user_id IN (SELECT id FROM public.profiles WHERE sgi_id = public.current_sgi_id())
    )
  )
  WITH CHECK (user_id = auth.uid() OR public.is_aotc_staff());

-- Cash / holdings / ledger / payments : soi + SGI agent + staff
CREATE POLICY cash_own ON public.cash_accounts
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_aotc_staff()
    OR (public.is_sgi_agent() AND user_id IN (
      SELECT id FROM public.profiles WHERE sgi_id = public.current_sgi_id()
    ))
  );

CREATE POLICY holdings_own ON public.holdings
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_aotc_staff()
    OR (public.is_sgi_agent() AND user_id IN (
      SELECT id FROM public.profiles WHERE sgi_id = public.current_sgi_id()
    ))
  );

CREATE POLICY ledger_own ON public.ledger_entries
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_aotc_staff()
    OR (public.is_sgi_agent() AND user_id IN (
      SELECT id FROM public.profiles WHERE sgi_id = public.current_sgi_id()
    ))
  );

CREATE POLICY payments_own ON public.payment_intents
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_aotc_staff()
    OR (public.is_sgi_agent() AND user_id IN (
      SELECT id FROM public.profiles WHERE sgi_id = public.current_sgi_id()
    ))
  );

CREATE POLICY payments_insert_own ON public.payment_intents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Orders
CREATE POLICY orders_own ON public.orders
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_aotc_staff()
    OR (public.is_sgi_agent() AND sgi_id = public.current_sgi_id())
  );

CREATE POLICY orders_insert_own ON public.orders
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Trades / settlements : parties + SGI + staff
CREATE POLICY trades_visible ON public.trades
  FOR SELECT TO authenticated
  USING (
    public.is_aotc_staff()
    OR buyer_user_id = auth.uid()
    OR seller_user_id = auth.uid()
    OR (public.is_sgi_agent() AND (
      buyer_sgi_id = public.current_sgi_id()
      OR seller_sgi_id = public.current_sgi_id()
    ))
  );

CREATE POLICY settlements_visible ON public.settlements
  FOR SELECT TO authenticated
  USING (
    public.is_aotc_staff()
    OR (public.is_sgi_agent() AND (
      buyer_sgi_id = public.current_sgi_id()
      OR seller_sgi_id = public.current_sgi_id()
    ))
  );

-- Liquidité / treasury / gouvernance / alertes : staff (+ lecture SGI limitée stats)
CREATE POLICY liq_staff ON public.liquidity_config
  FOR ALL TO authenticated
  USING (public.is_aotc_staff())
  WITH CHECK (public.is_aotc_staff());

CREATE POLICY liq_inv_staff ON public.liquidity_inventory
  FOR ALL TO authenticated
  USING (public.is_aotc_staff())
  WITH CHECK (public.is_aotc_staff());

CREATE POLICY liq_lim_staff ON public.liquidity_limits
  FOR ALL TO authenticated
  USING (public.is_aotc_staff())
  WITH CHECK (public.is_aotc_staff());

CREATE POLICY treasury_staff ON public.treasury_positions
  FOR SELECT TO authenticated
  USING (public.is_aotc_staff());

CREATE POLICY treasury_res_staff ON public.treasury_reservations
  FOR SELECT TO authenticated
  USING (public.is_aotc_staff());

CREATE POLICY gov_staff ON public.governance_proposals
  FOR ALL TO authenticated
  USING (public.is_aotc_staff())
  WITH CHECK (public.is_aotc_staff());

CREATE POLICY alerts_staff ON public.monitoring_alerts
  FOR SELECT TO authenticated
  USING (public.is_aotc_staff() OR public.is_sgi_agent());

CREATE POLICY decision_staff ON public.decision_signals
  FOR SELECT TO authenticated
  USING (public.is_aotc_staff());

CREATE POLICY api_keys_sgi ON public.api_keys
  FOR SELECT TO authenticated
  USING (
    public.is_aotc_staff()
    OR (public.is_sgi_agent() AND sgi_id = public.current_sgi_id())
  );

CREATE POLICY partner_stats_sgi ON public.partner_stats_daily
  FOR SELECT TO authenticated
  USING (
    public.is_aotc_staff()
    OR (public.is_sgi_agent() AND sgi_id = public.current_sgi_id())
  );

CREATE POLICY audit_visible ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    public.is_aotc_staff()
    OR actor_user_id = auth.uid()
    OR (public.is_sgi_agent() AND actor_user_id IN (
      SELECT id FROM public.profiles WHERE sgi_id = public.current_sgi_id()
    ))
  );

CREATE POLICY audit_insert_authenticated ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Écritures métier sensibles : service_role / backend uniquement
-- (pas de policy INSERT/UPDATE sur trades, ledger, inventory pour authenticated)
-- Utiliser la clé service_role côté API Gateway / moteurs adapters.

-- -----------------------------------------------------------------------------
-- Seeds DEMO (sandbox)
-- -----------------------------------------------------------------------------
INSERT INTO public.sgis (id, code, name, commission_bps)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'SGI_DEMO', 'SGI Démo Partenaire', 10),
  ('22222222-2222-2222-2222-222222222222', 'SGI_LIQ', 'SGI Liquidité AOTC', 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.exchanges (id, code, name)
VALUES ('33333333-3333-3333-3333-333333333333', 'DEMO', 'Exchange de démonstration')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.markets (id, exchange_id, code, name, segment)
VALUES (
  '44444444-4444-4444-4444-444444444444',
  '33333333-3333-3333-3333-333333333333',
  'EQUITY',
  'Marché Actions',
  'equity'
)
ON CONFLICT (exchange_id, code) DO NOTHING;

INSERT INTO public.assets (id, symbol, name, asset_class, sector, tick_size, lot_size) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'SNTS', 'Sonatel', 'equity', 'telecom', 5, 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', 'ORAG', 'Orange CI', 'equity', 'telecom', 5, 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', 'SGBC', 'SGBC', 'equity', 'bank', 5, 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', 'BOAB', 'BOA', 'equity', 'bank', 5, 1),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5', 'TTLC', 'TotalEnergies', 'equity', 'energy', 5, 1)
ON CONFLICT (symbol) DO NOTHING;

INSERT INTO public.instruments (id, asset_id, exchange_id, market_id, local_symbol, tick_size, lot_size)
VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
   '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'SNTS', 5, 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2',
   '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'ORAG', 5, 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3',
   '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'SGBC', 5, 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4',
   '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'BOAB', 5, 1),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa5',
   '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', 'TTLC', 5, 1)
ON CONFLICT (exchange_id, local_symbol) DO NOTHING;

INSERT INTO public.liquidity_config (mode, partner_sgi_id)
SELECT 'SGI_PARTNER', id FROM public.sgis WHERE code = 'SGI_LIQ'
LIMIT 1;

INSERT INTO public.liquidity_inventory (asset_id, qty, avg_cost)
SELECT id, 5000, 0 FROM public.assets
ON CONFLICT (asset_id) DO NOTHING;

INSERT INTO public.liquidity_limits (scope, scope_ref, max_qty, max_notional) VALUES
  ('global', NULL, 200000, NULL),
  ('asset', 'SNTS', 50000, NULL)
ON CONFLICT (scope, scope_ref) DO NOTHING;

INSERT INTO public.treasury_positions (source, label, available, immobilized, ceiling, drawn) VALUES
  ('aotc_own', 'Capital propre AOTC', 500000000, 0, NULL, 0),
  ('coris', 'Capital Coris', 500000000, 0, NULL, 0),
  ('credit_line', 'Ligne de crédit', 0, 0, 1000000000, 0);

-- Prix de référence initiaux (minor units)
INSERT INTO public.market_prices (instrument_id, last, mid, source)
SELECT i.id, v.last, v.last, 'aotc_computed'
FROM public.instruments i
JOIN (
  VALUES
    ('SNTS', 15000::bigint),
    ('ORAG', 12000::bigint),
    ('SGBC', 85000::bigint),
    ('BOAB', 4200::bigint),
    ('TTLC', 2800::bigint)
) AS v(symbol, last) ON v.symbol = i.local_symbol;

-- -----------------------------------------------------------------------------
-- Storage KYC (à créer aussi dans Dashboard → Storage si besoin)
-- -----------------------------------------------------------------------------
-- insert into storage.buckets (id, name, public) values ('kyc', 'kyc', false);
-- Policies storage à ajouter selon ton flux upload.

NOTIFY pgrst, 'reload schema';
