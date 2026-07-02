-- M2: daily information diet (roadmap docs/active-roadmap-v2.md).
-- Idempotent — safe to re-run.
--
-- 1. earnings_calendar — next report date per tracked name, auto-estimated
--    from EDGAR filing cadence by fetch-saas-revenue (source='edgar_estimate');
--    manual/confirmed rows are never overwritten by the estimator.
-- 2. signal_features — unstructured-text features (news-pulse Haiku triage).
-- 3. 'midday' tick type — event-driven ticks fired by agent-event-watch.
-- 4. Crons: news-pulse daily 11:00 UTC; agent-event-watch every 30 min in
--    market hours; NO fixed midday agent-tick — midday ticks are event-only.

-- ————— 1. earnings calendar —————

CREATE TABLE IF NOT EXISTS earnings_calendar (
  ticker TEXT PRIMARY KEY,
  report_date DATE NOT NULL,
  source TEXT NOT NULL DEFAULT 'edgar_estimate',
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ————— 2. unstructured-text features —————

CREATE TABLE IF NOT EXISTS signal_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ticker TEXT NOT NULL,
  feature TEXT NOT NULL,
  value NUMERIC NOT NULL,
  detail JSONB
);
CREATE INDEX IF NOT EXISTS idx_signal_features_lookup
  ON signal_features(ticker, feature, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_features_observed
  ON signal_features(observed_at DESC);

-- ————— 3. midday tick type —————

ALTER TABLE agent_snapshots DROP CONSTRAINT IF EXISTS agent_snapshots_tick_type_check;
ALTER TABLE agent_snapshots ADD CONSTRAINT agent_snapshots_tick_type_check
  CHECK (tick_type IN ('premarket', 'midday', 'close', 'weekly'));

-- ————— RLS —————

ALTER TABLE earnings_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_features   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'earnings_calendar' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON earnings_calendar FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'signal_features' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON signal_features FOR SELECT USING (true);
  END IF;
END $$;

-- ————— 4. crons —————

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'news-pulse-daily',
  '0 11 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/news-pulse',
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
  'agent-event-watch',
  '*/30 13-21 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-event-watch',
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
