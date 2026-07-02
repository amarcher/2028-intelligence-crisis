-- M4: Phase-2 capitalization playbook (roadmap docs/active-roadmap-v2.md).
-- Idempotent — safe to re-run (seed uses ON CONFLICT).
--
-- 1. playbooks — the Phase-2 rotation PRE-WRITTEN as data. When the fired
--    count crosses 2 (or 3), agent-tick converts the level's steps into
--    concrete proposals (strikes computed from live tape) and attaches them
--    to the owner-approval request. Approving executes the pre-registered
--    plan — no improvisation during the panic.
-- 2. agent_position_rules.vix_harvested_at — throttle for the VIX-tiered
--    profit harvest (VIX ≥ 40 → bank 1/3 of any put at ≥ 2× entry).
-- 3. Cron: agent-queue-flush every 30 min during market hours — it now also
--    EXECUTES approved-but-unexecuted approvals (previously approvals were
--    marked approved in the dashboard and then nothing happened, ever).

-- ————— 1. playbooks —————

CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,                    -- '<level>:<step_order>'
  trigger_level TEXT NOT NULL CHECK (trigger_level IN ('fired_2', 'fired_3')),
  step_order INT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('open', 'add', 'trim', 'close')),
  ticker TEXT NOT NULL,
  instrument TEXT NOT NULL CHECK (instrument IN ('equity', 'put', 'call', 'put_spread', 'call_spread')),
  -- Months until expiry (executor maps to a concrete listed expiry).
  expiry_months INT,
  -- Strike as % below spot for puts (10 = 10% OTM). Concrete strikes are
  -- computed from live tape when the approval is created.
  strike_pct_otm NUMERIC,
  -- Short-leg % OTM for spreads.
  strike_short_pct_otm NUMERIC,
  size_hint TEXT NOT NULL CHECK (size_hint IN ('starter', 'half', 'full', 'trim_third', 'trim_half')),
  rationale TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE playbooks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'playbooks' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON playbooks FOR SELECT USING (true);
  END IF;
END $$;

-- Seed: the rotation decided calmly, in advance. Sizes stay inside normal
-- guardrail caps; anything bigger goes through the oversize-approval path.
INSERT INTO playbooks (id, trigger_level, step_order, action, ticker, instrument, expiry_months, strike_pct_otm, strike_short_pct_otm, size_hint, rationale, enabled) VALUES
  -- ——— 2 of 6 readings crossed: start the rotation ———
  ('fired_2:1', 'fired_2', 1, 'close', 'QQQ', 'equity', NULL, NULL, NULL, 'full',
   'Two danger lines have crossed — the plan says stop riding the AI rally first. Selling the QQQ holding.', TRUE),
  ('fired_2:2', 'fired_2', 2, 'trim', 'NOW', 'put', NULL, NULL, NULL, 'trim_third',
   'Banking a third of the ServiceNow put — the plan takes some profit into the first confirmation, and keeps the rest for the bigger move.', TRUE),
  ('fired_2:3', 'fired_2', 3, 'trim', 'CRM', 'put', NULL, NULL, NULL, 'trim_third',
   'Banking a third of the Salesforce put, same as ServiceNow — profit into first confirmation.', TRUE),
  ('fired_2:4', 'fired_2', 4, 'open', 'SPY', 'put_spread', 4, 10, 20, 'half',
   'Opening the first broad-market bet: a defined-risk put spread on the S&P 500 (pays if the market falls 10-20% in the next 4 months).', TRUE),
  ('fired_2:5', 'fired_2', 5, 'open', 'QQQ', 'put_spread', 4, 10, 20, 'half',
   'Same defined-risk structure on the tech-heavy index, where the prediction says the fall is hardest.', TRUE),
  ('fired_2:6', 'fired_2', 6, 'add', 'GLD', 'equity', NULL, NULL, NULL, 'starter',
   'Adding a bit more gold — the safe-haven side grows as the risk side rotates.', TRUE),
  -- ——— 3 of 6 readings crossed: contagion positioning ———
  ('fired_3:1', 'fired_3', 1, 'open', 'HYG', 'put', 5, 5, NULL, 'half',
   'Three danger lines crossed — time for the credit bet: a put on the junk-bond fund (pays if risky-company borrowing costs blow out).', TRUE),
  ('fired_3:2', 'fired_3', 2, 'open', 'KRE', 'put', 5, 10, NULL, 'half',
   'A put on regional banks — they hold the commercial real estate and business loans that crack in the contagion phase.', TRUE),
  ('fired_3:3', 'fired_3', 3, 'open', 'IYR', 'put', 5, 10, NULL, 'starter',
   'A starter put on real estate — offices and commercial property are the slowest domino but a heavy one.', TRUE),
  ('fired_3:4', 'fired_3', 4, 'add', 'TLT', 'equity', NULL, NULL, NULL, 'half',
   'Adding to long-term government bonds — the classic flight-to-safety trade when credit stress spreads.', TRUE)
ON CONFLICT (id) DO UPDATE SET
  trigger_level = EXCLUDED.trigger_level,
  step_order = EXCLUDED.step_order,
  action = EXCLUDED.action,
  ticker = EXCLUDED.ticker,
  instrument = EXCLUDED.instrument,
  expiry_months = EXCLUDED.expiry_months,
  strike_pct_otm = EXCLUDED.strike_pct_otm,
  strike_short_pct_otm = EXCLUDED.strike_short_pct_otm,
  size_hint = EXCLUDED.size_hint,
  rationale = EXCLUDED.rationale;

-- ————— 2. VIX harvest throttle —————

ALTER TABLE agent_position_rules
  ADD COLUMN IF NOT EXISTS vix_harvested_at TIMESTAMPTZ;

-- ————— 3. intraday flush cron (also executes approved approvals) —————

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'agent-queue-flush-intraday',
  '6,36 15-20 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-queue-flush',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'service_role_key' LIMIT 1
      ),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);
