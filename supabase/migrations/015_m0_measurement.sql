-- M0: measurement + data integrity (roadmap docs/active-roadmap-v2.md).
-- Idempotent — safe to re-run.
--
-- 1. Purge the SaaS growth series: the old fetch-saas-revenue mislabeled
--    offset fiscal years as calendar dates (Salesforce FY2027 Q1 landed as a
--    future-dated 2027-01-01 row) and then broke entirely on a scoping bug,
--    leaving saas_WDAY / saas_DDOG empty and saas_NOW months stale. The fixed
--    function re-ingests everything with calendar-true (quarter-END) dates.
--    ⚠ Deploy runbook: `supabase functions deploy fetch-saas-revenue` then
--    invoke it once, or the SaaS trigger reads '—' until the Monday cron.
-- 2. agent_equity_snapshots — per-tick equity curve + per-leg values +
--    benchmark closes. Without this no Sharpe / drawdown / alpha exists.
-- 3. meta_indices — persisted meta-signal history (TAI, positioning ratio,
--    regime disagreement, …) written every tick by agent-tick.
-- 4. agent_orders.proposal — full proposal JSON on queued rows so
--    agent-queue-flush can re-validate and place them at the open.
-- 5. Cron: agent-queue-flush at 13:36 & 14:36 UTC weekdays (one of the two is
--    just-after-open in each DST regime; the pre-open one no-ops), reusing the
--    vault-backed Authorization pattern from migration 014.

-- ————— 1. SaaS series purge —————

DELETE FROM economic_data WHERE series_id LIKE 'saas_%';

-- ————— 2. equity snapshots —————

CREATE TABLE IF NOT EXISTS agent_equity_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tick_type TEXT,
  equity NUMERIC NOT NULL,
  cash NUMERIC,
  buying_power NUMERIC,
  unrealized_pl NUMERIC,
  saas_put_value NUMERIC,
  ai_long_value NUMERIC,
  defensive_value NUMERIC,
  gross_exposure NUMERIC,
  spy_close NUMERIC,
  qqq_close NUMERIC,
  igv_close NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_agent_equity_snapshots_taken
  ON agent_equity_snapshots(taken_at DESC);

-- ————— 3. meta indices —————

CREATE TABLE IF NOT EXISTS meta_indices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  key TEXT NOT NULL,
  value NUMERIC NOT NULL,
  detail JSONB
);
CREATE INDEX IF NOT EXISTS idx_meta_indices_key_observed
  ON meta_indices(key, observed_at DESC);

-- ————— 4. queued-order payload —————

ALTER TABLE agent_orders
  ADD COLUMN IF NOT EXISTS proposal JSONB;

-- ————— RLS (public read, service-role write — existing pattern) —————

ALTER TABLE agent_equity_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_indices           ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_equity_snapshots' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON agent_equity_snapshots FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'meta_indices' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON meta_indices FOR SELECT USING (true);
  END IF;
END $$;

-- ————— 5. queue-flush cron —————

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'agent-queue-flush-open',
  '36 13 * * 1-5',
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

SELECT cron.schedule(
  'agent-queue-flush-open-dst',
  '36 14 * * 1-5',
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
