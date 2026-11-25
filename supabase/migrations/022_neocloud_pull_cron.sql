-- pg_cron schedule for neocloud-pull (daily prices + Kalshi odds).
-- Runs weekdays 22:00 UTC, after the US close (5 PM ET standard / 6 PM ET daylight).
-- Uses the vault-stored service_role_key, as in 014_cron_auth_header.sql.
-- cron.schedule is idempotent on job name — safe to re-run.
-- Run via Supabase SQL Editor.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'neocloud-pull',
  '0 22 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/neocloud-pull',
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

-- First run / backfill (one year of prices):
--   curl -X POST https://ppxlpanujqticegujomt.supabase.co/functions/v1/neocloud-pull \
--        -H "Authorization: Bearer <service-role-key>" -d '{"range":"1y"}'
-- Unschedule: SELECT cron.unschedule('neocloud-pull');
