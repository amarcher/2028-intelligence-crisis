-- pg_cron schedule for portfolio-report (daily post-close Slack snapshot).
-- Runs at 20:15 UTC Mon-Fri — ~16:15 ET during EDT, ~15:15 ET during EST.
-- Alpaca's `last_equity` updates at the open, so by ~15 min post-close the
-- account's `equity` reflects the final end-of-day mark and the day delta is
-- just `equity - last_equity`.
--
-- cron.schedule is idempotent on job name — safe to re-run.
-- NOTE: Run via Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'portfolio-report-daily',
  '15 20 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/portfolio-report',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Inspection helpers:
-- SELECT * FROM cron.job WHERE jobname = 'portfolio-report-daily';
-- SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'portfolio-report-daily') ORDER BY start_time DESC LIMIT 10;
-- Unschedule:   SELECT cron.unschedule('portfolio-report-daily');
