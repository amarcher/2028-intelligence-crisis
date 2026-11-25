-- Neocloud Policy Watch — does data center policy move the neocloud trade?
--
-- market_prices:   daily closes for IREN, a neocloud peer basket and QQQ.
-- policy_events:   dated events tagged 'policy' or 'other'; the dashboard runs
--                  an event study around each (src/lib/eventStudy.ts).
-- prediction_odds: snapshots of Kalshi data center moratorium markets.
-- neocloud_scrape_log: one row per ingestion attempt (freshness footer).
--
-- Filled by the neocloud-pull Edge Function (cron in 022). Policy events are
-- curated by hand: add rows in the SQL Editor as news happens.
-- Run via Supabase SQL Editor.

CREATE TABLE market_prices (
  ticker      TEXT NOT NULL,
  trade_date  DATE NOT NULL,
  close       NUMERIC NOT NULL,          -- split/dividend-adjusted close
  source      TEXT NOT NULL DEFAULT 'yahoo',
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, trade_date)
);

CREATE INDEX market_prices_date_idx ON market_prices (trade_date DESC);

CREATE TABLE policy_events (
  id          BIGSERIAL PRIMARY KEY,
  event_date  DATE NOT NULL,             -- first trading day the news could move prices
  kind        TEXT NOT NULL CHECK (kind IN ('policy', 'other')),
  label       TEXT NOT NULL,
  source_url  TEXT,
  inserted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_date, label)
);

CREATE TABLE prediction_odds (
  id            BIGSERIAL PRIMARY KEY,
  venue         TEXT NOT NULL DEFAULT 'kalshi',
  market_ticker TEXT NOT NULL,
  observed_at   TIMESTAMPTZ NOT NULL,
  yes_price     NUMERIC,                 -- 0–1 (probability)
  yes_bid       NUMERIC,
  yes_ask       NUMERIC,
  volume        NUMERIC,
  close_time    TIMESTAMPTZ,
  meta          JSONB DEFAULT '{}'::jsonb,
  UNIQUE (venue, market_ticker, observed_at)
);

CREATE INDEX prediction_odds_market_idx ON prediction_odds (market_ticker, observed_at DESC);

CREATE TABLE neocloud_scrape_log (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL,             -- 'yahoo' | 'kalshi'
  status      TEXT NOT NULL,             -- 'ok' | 'fail'
  rows        INT,
  error       TEXT,
  duration_ms INT,
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Latest snapshot per Kalshi market.
CREATE OR REPLACE VIEW prediction_odds_latest AS
SELECT DISTINCT ON (venue, market_ticker)
  venue, market_ticker, observed_at, yes_price, yes_bid, yes_ask, volume, close_time
FROM prediction_odds
ORDER BY venue, market_ticker, observed_at DESC;

-- RLS: public read, service-role writes (same as shipping_signals).
ALTER TABLE market_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON market_prices FOR SELECT USING (true);
ALTER TABLE policy_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON policy_events FOR SELECT USING (true);
ALTER TABLE prediction_odds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON prediction_odds FOR SELECT USING (true);
ALTER TABLE neocloud_scrape_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON neocloud_scrape_log FOR SELECT USING (true);

-- Seed events (mirrors SEED_EVENTS in src/lib/eventStudy.ts).
INSERT INTO policy_events (event_date, kind, label, source_url) VALUES
  ('2026-08-03', 'policy', 'Abbott orders Texas data center audit; ERCOT pauses 75 MW+ approvals', 'https://www.texastribune.org/2026/08/03/texas-data-center-project-audit-greg-abbott/'),
  ('2026-09-08', 'policy', 'Sweetwater gets conditional ERCOT base load status', 'https://theenergymag.com/news/market-news/iren-2-gigawatt-sweetwater-base-load-ercot'),
  ('2026-09-18', 'policy', 'Virginia EO 22 ends by-right zoning for 25 MW+', 'https://www.electricchoice.com/datacenters/moratoriums/'),
  ('2026-11-04', 'policy', 'Hinojosa wins Texas governor race (first trading day after)', 'https://www.ksat.com/news/texas/2026/11/04/democrat-gina-hinojosa-topples-greg-abbott-to-become-first-latina-governor-of-texas/'),
  ('2026-12-10', 'policy', 'ERCOT Batch Zero audit reports due', 'https://www.ercot.com/files/docs/2026/09/11/14-Batch-Zero-Update.pdf'),
  ('2026-08-13', 'other',  'Microsoft accepts IREN Horizon 1', NULL),
  ('2026-08-27', 'other',  'IREN FY26 results', NULL),
  ('2026-11-05', 'other',  'IREN Q1 FY27 results', NULL),
  ('2026-11-23', 'other',  'Nvidia reinstates Jensen Huang as CEO', NULL)
ON CONFLICT (event_date, label) DO NOTHING;
