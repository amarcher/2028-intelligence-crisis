-- Schema for auto-execution mode. No code path reads/writes these yet — this
-- migration is the foundation for Exec-2 through Exec-8. Applying it alone
-- changes no behavior (the agent-tick function still runs signal-only).
-- Idempotent: safe to re-run.

-- ————— agent_config extensions —————

ALTER TABLE agent_config
  -- Four-phase rollout gate. Shadow = signal-only (current). paper = Alpaca paper.
  -- small_live = funded live, tight caps. scale = open-ended.
  ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'shadow'
    CHECK (phase IN ('shadow', 'paper', 'small_live', 'scale')),
  -- Backup toggle: lets us force paper mode even when phase is small_live/scale
  -- (e.g., for end-to-end validation without risking real capital).
  ADD COLUMN IF NOT EXISTS paper_mode BOOLEAN NOT NULL DEFAULT TRUE,
  -- Hard ceiling on what the agent is allowed to operate with (USD). Guardrails
  -- scale per-ticket / daily / etc. off this value. Null = disabled; mirror in
  -- the Alpaca account cap setting for defense in depth.
  ADD COLUMN IF NOT EXISTS account_cap_usd NUMERIC,
  -- Medium-kill state: daily loss stop halts entries until owner resumes.
  -- Distinct from the deadman (killed_reason) which is about reasoner failures.
  ADD COLUMN IF NOT EXISTS halted BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS halt_reason TEXT,
  ADD COLUMN IF NOT EXISTS halted_at TIMESTAMPTZ;

-- ————— agent_approvals —————
-- Queue of things that need owner click-through before execution. Kinds:
--   phase_flip        — 2+ signals fired, agent proposes the full Phase-2 rotation
--   oversize_ticket   — single proposal >5% of account
--   new_ticker        — off-whitelist suggestion
--   unwind_all        — anti-thesis kill recommended unwind
--   resume_after_halt — owner must re-arm after the daily-loss-stop fires
CREATE TABLE IF NOT EXISTS agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_id UUID REFERENCES agent_digests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  kind TEXT NOT NULL CHECK (kind IN (
    'phase_flip', 'oversize_ticket', 'new_ticker', 'unwind_all', 'resume_after_halt'
  )),
  -- Snapshot of the proposal(s) at request time so approval isn't ambiguous if
  -- the next tick produces different proposals while this one is pending.
  proposals JSONB NOT NULL,
  rationale TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  executed BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_status
  ON agent_approvals(status, created_at DESC);

-- ————— agent_orders —————
-- Every order the agent submits, with status tracked from queue through fill.
-- digest_id links back to the tick that generated it; approval_id populated
-- when the order required an explicit approval.
CREATE TABLE IF NOT EXISTS agent_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  digest_id UUID REFERENCES agent_digests(id) ON DELETE SET NULL,
  approval_id UUID REFERENCES agent_approvals(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  alpaca_order_id TEXT UNIQUE,        -- set after submission; null before
  ticker TEXT NOT NULL,
  instrument TEXT NOT NULL CHECK (instrument IN (
    'equity', 'put', 'call', 'put_spread', 'call_spread'
  )),
  option_symbol TEXT,                  -- OCC symbol for options, null for equity
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  qty NUMERIC NOT NULL,
  order_type TEXT NOT NULL DEFAULT 'limit'
    CHECK (order_type IN ('market', 'limit')),
  limit_price NUMERIC,
  notional_usd NUMERIC,                -- approx at submission, for reporting
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'submitted', 'filled', 'partially_filled',
      'canceled', 'rejected', 'expired'
    )),
  submitted_at TIMESTAMPTZ,
  filled_at TIMESTAMPTZ,
  filled_qty NUMERIC,
  filled_avg_price NUMERIC,
  rejection_reason TEXT,
  raw_alpaca JSONB                     -- last Alpaca payload seen
);
CREATE INDEX IF NOT EXISTS idx_agent_orders_created
  ON agent_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_orders_status
  ON agent_orders(status, created_at DESC);

-- ————— agent_fills —————
-- Individual fill events. One order can have multiple fills (partial fills).
-- Populated when we observe trade events from Alpaca webhook OR when we poll
-- order status and the fill counts change.
CREATE TABLE IF NOT EXISTS agent_fills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES agent_orders(id) ON DELETE CASCADE,
  filled_at TIMESTAMPTZ NOT NULL,
  qty NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  side TEXT NOT NULL,
  ticker TEXT NOT NULL,
  option_symbol TEXT,
  alpaca_trade_id TEXT UNIQUE          -- dedup key from Alpaca
);
CREATE INDEX IF NOT EXISTS idx_agent_fills_filled
  ON agent_fills(filled_at DESC);

-- ————— agent_positions_cache —————
-- Current-position snapshot synced from Alpaca. Regenerated each tick so the
-- guardrail can cheaply check single-name exposure without re-hitting Alpaca.
CREATE TABLE IF NOT EXISTS agent_positions_cache (
  ticker TEXT NOT NULL,
  option_symbol TEXT,
  qty NUMERIC NOT NULL,
  avg_entry NUMERIC,
  market_value NUMERIC,
  unrealized_pl NUMERIC,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, COALESCE(option_symbol, ''))
);

-- ————— RLS: match existing pattern (public read, service-role write) —————

ALTER TABLE agent_approvals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_fills            ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_positions_cache  ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_approvals' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON agent_approvals FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_orders' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON agent_orders FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_fills' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON agent_fills FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_positions_cache' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON agent_positions_cache FOR SELECT USING (true);
  END IF;
END $$;

-- Owner-only UPDATE on approvals lands in Exec-6 alongside phase-promotion
-- policy. This migration intentionally leaves writes service-role only.
