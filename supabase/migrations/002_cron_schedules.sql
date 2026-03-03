-- Cron schedule for fetch-saas-revenue edge function
-- fetch-fred-daily was already configured manually in Supabase dashboard.
--
-- NOTE: Run this via the Supabase SQL Editor (Dashboard > SQL Editor).

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule fetch-saas-revenue: weekly on Mondays at 6:05 UTC
SELECT cron.schedule(
  'fetch-saas-revenue-weekly',
  '5 6 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/fetch-saas-revenue',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- View scheduled jobs:  SELECT * FROM cron.job;
-- View run history:     SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
-- Unschedule a job:     SELECT cron.unschedule('fetch-saas-revenue-weekly');
