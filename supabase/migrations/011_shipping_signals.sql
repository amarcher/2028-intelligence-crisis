-- Shipping Pulse — core time-series table for container freight, dry bulk,
-- port density, and FRED macro proxies. Every source upserts rows here keyed
-- on (source, metric, observed_at). Source-specific quirks live in meta.
--
-- Named shipping_signals (not signals) to avoid collision with the existing
-- "phase-flip signals" concept already used throughout the dashboard code.
--
-- Run via Supabase SQL Editor.

CREATE TABLE shipping_signals (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL,        -- 'drewry_wci' | 'fbx' | 'bdry' | 'mt_density' | 'fred' | 'la_signal'
  metric      TEXT NOT NULL,        -- 'composite' | 'shanghai_la' | 'anchor_count' | 'retailirsa' | ...
  observed_at TIMESTAMPTZ NOT NULL, -- the source's own timestamp, not insertion time
  value       NUMERIC NOT NULL,
  unit        TEXT NOT NULL,        -- 'usd_per_40ft' | 'index' | 'vessels' | 'ratio' | ...
  meta        JSONB DEFAULT '{}'::jsonb,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source, metric, observed_at)
);

CREATE INDEX shipping_signals_source_metric_observed_idx
  ON shipping_signals (source, metric, observed_at DESC);

CREATE INDEX shipping_signals_observed_idx
  ON shipping_signals (observed_at DESC);

-- Per-run log of ingestion attempts — drives the status endpoint + UI footer.
CREATE TABLE shipping_signal_scrape_log (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL,
  status      TEXT NOT NULL,        -- 'ok' | 'fail' | 'skipped'
  rows        INT,
  error       TEXT,
  duration_ms INT,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX shipping_signal_scrape_log_source_ran_idx
  ON shipping_signal_scrape_log (source, ran_at DESC);

-- Latest observation per (source, metric) — what the dashboard top-strip reads.
CREATE OR REPLACE VIEW shipping_signals_latest AS
SELECT DISTINCT ON (source, metric)
  source, metric, observed_at, value, unit, meta
FROM shipping_signals
ORDER BY source, metric, observed_at DESC;

-- Week-over-week % change per (source, metric). Agent API surfaces this so
-- the UI and agent cannot disagree about "transpacific rates are rising".
CREATE OR REPLACE VIEW shipping_signals_wow AS
SELECT
  s.source,
  s.metric,
  s.observed_at,
  s.value,
  s.unit,
  LAG(s.value)  OVER w AS prev_value,
  CASE
    WHEN LAG(s.value) OVER w IS NULL OR LAG(s.value) OVER w = 0 THEN NULL
    ELSE ROUND(((s.value - LAG(s.value) OVER w) / LAG(s.value) OVER w * 100)::numeric, 2)
  END AS wow_pct
FROM shipping_signals s
WINDOW w AS (PARTITION BY s.source, s.metric ORDER BY s.observed_at);

-- Per-source freshness for /status. Ranks most-recent successful pull +
-- counts consecutive failures after it.
CREATE OR REPLACE VIEW shipping_signal_source_status AS
WITH last_ok AS (
  SELECT source, MAX(ran_at) AS last_ok_at
  FROM shipping_signal_scrape_log
  WHERE status = 'ok'
  GROUP BY source
),
last_any AS (
  SELECT source, MAX(ran_at) AS last_run_at
  FROM shipping_signal_scrape_log
  GROUP BY source
),
consec_fails AS (
  SELECT l.source, COUNT(*) AS consecutive_failures
  FROM shipping_signal_scrape_log l
  LEFT JOIN last_ok o ON o.source = l.source
  WHERE l.status = 'fail'
    AND (o.last_ok_at IS NULL OR l.ran_at > o.last_ok_at)
  GROUP BY l.source
)
SELECT
  la.source,
  o.last_ok_at,
  la.last_run_at,
  COALESCE(cf.consecutive_failures, 0) AS consecutive_failures,
  CASE
    WHEN o.last_ok_at IS NULL THEN FALSE
    WHEN o.last_ok_at < NOW() - INTERVAL '14 days' THEN FALSE
    ELSE TRUE
  END AS fresh
FROM last_any la
LEFT JOIN last_ok o      ON o.source = la.source
LEFT JOIN consec_fails cf ON cf.source = la.source;

-- RLS: public read on core table + scrape log (so the dashboard can show the
-- status footer without a service key). Writes are service-role only.
ALTER TABLE shipping_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON shipping_signals FOR SELECT USING (true);

ALTER TABLE shipping_signal_scrape_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON shipping_signal_scrape_log FOR SELECT USING (true);
