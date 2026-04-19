-- pg_cron schedule for shipping-pulse-pull (weekly macro ingestion).
-- Runs Mondays 14:15 UTC (~09:15 ET standard / 10:15 ET daylight). After
-- the weekend so Freightos has published Thursday's Drewry proxies and
-- Monday's early-week rate revisions before we scrape.
--
-- cron.schedule is idempotent on job name — safe to re-run.
-- Run via Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'shipping-pulse-pull',
  '15 14 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/shipping-pulse-pull',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Inspection helpers:
-- SELECT * FROM cron.job WHERE jobname = 'shipping-pulse-pull';
-- SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'shipping-pulse-pull') ORDER BY start_time DESC LIMIT 20;
-- Manual fire:  SELECT cron.schedule(...); or just invoke the function directly.
-- Unschedule:   SELECT cron.unschedule('shipping-pulse-pull');
