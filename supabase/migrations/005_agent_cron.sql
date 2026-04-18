-- pg_cron schedules for the agent-tick edge function.
-- Two daily digests Mon-Fri + one weekly "state of the thesis" tick on Mondays.
-- Times assume EDT (UTC-4). During EST, ticks run ~1 hour later vs. nominal ET —
-- acceptable drift for signal-only digest cadence. Revisit if cross-DST accuracy
-- becomes important (store a holiday + DST table, or use dynamic scheduling).
--
-- NOTE: Run this via the Supabase SQL Editor (Dashboard > SQL Editor).
-- cron.schedule is idempotent on the job name — safe to re-run to update times.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Premarket: 09:15 ET = 13:15 UTC, Mon-Fri.
-- Reads overnight FRED/SEC prints before the US open.
SELECT cron.schedule(
  'agent-tick-premarket',
  '15 13 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-tick',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"tick_type":"premarket"}'::jsonb
  );
  $$
);

-- Pre-close: 15:45 ET = 19:45 UTC, Mon-Fri.
-- Last chance to rebalance before the session ends.
SELECT cron.schedule(
  'agent-tick-close',
  '45 19 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-tick',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"tick_type":"close"}'::jsonb
  );
  $$
);

-- Weekly: Monday 08:00 ET = 12:00 UTC.
-- "State of the thesis" — re-scored scorecard + richer narrative.
SELECT cron.schedule(
  'agent-tick-weekly',
  '0 12 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-tick',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"tick_type":"weekly"}'::jsonb
  );
  $$
);

-- View scheduled jobs:  SELECT * FROM cron.job WHERE jobname LIKE 'agent-tick-%';
-- View run history:     SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname LIKE 'agent-tick-%') ORDER BY start_time DESC LIMIT 20;
-- Unschedule a job:     SELECT cron.unschedule('agent-tick-premarket');
