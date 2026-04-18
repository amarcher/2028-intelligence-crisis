-- pg_cron schedule for agent-kill-check (daily loss-stop watchdog).
-- Runs every 15 minutes 14:00–21:00 UTC Mon–Fri — covers the US market
-- session with slack on both ends across EDT/EST. The function guards on
-- market hours internally so off-hour fires are cheap no-ops.
--
-- cron.schedule is idempotent on job name — safe to re-run.
-- NOTE: Run via Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'agent-kill-check',
  '*/15 14-21 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-kill-check',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

-- Inspection helpers:
-- SELECT * FROM cron.job WHERE jobname = 'agent-kill-check';
-- SELECT * FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'agent-kill-check') ORDER BY start_time DESC LIMIT 20;
-- Unschedule:   SELECT cron.unschedule('agent-kill-check');
