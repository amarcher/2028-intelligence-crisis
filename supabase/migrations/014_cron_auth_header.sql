-- Fix: cron-triggered Edge Function calls were 401-ing at the Supabase gateway
-- because net.http_post was sending no Authorization header. Supabase Edge
-- Functions default to verify_jwt=true; without an Authorization: Bearer
-- <service_role_key> the gateway returns 401 UNAUTHORIZED_NO_AUTH_HEADER and
-- the function never runs. pg_cron's job_run_details misleadingly reports
-- 'succeeded' (that only tracks pg_net enqueue, not the HTTP response).
--
-- The JWT is read from supabase_vault at job run time, so the secret stays
-- out of git. One-time setup (run via SQL Editor, not committed):
--   SELECT vault.create_secret('<service_role_jwt>', 'service_role_key',
--     'JWT for pg_cron to authenticate Edge Function invocations');
--
-- cron.schedule is idempotent on job name — safe to re-run. Affected jobs
-- (fetch-fred-daily already embeds an Authorization header and is left
-- untouched):
--   agent-tick-premarket, agent-tick-close, agent-tick-weekly,
--   agent-kill-check, portfolio-report-daily, shipping-pulse-pull,
--   fetch-saas-revenue-weekly.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ——— agent-tick (premarket / close / weekly) ———

SELECT cron.schedule(
  'agent-tick-premarket',
  '15 13 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'service_role_key' LIMIT 1
      ),
      'Content-Type', 'application/json'
    ),
    body := '{"tick_type":"premarket"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'agent-tick-close',
  '45 19 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'service_role_key' LIMIT 1
      ),
      'Content-Type', 'application/json'
    ),
    body := '{"tick_type":"close"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'agent-tick-weekly',
  '0 12 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-tick',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
        WHERE name = 'service_role_key' LIMIT 1
      ),
      'Content-Type', 'application/json'
    ),
    body := '{"tick_type":"weekly"}'::jsonb
  );
  $$
);

-- ——— agent-kill-check (every 15 min during market hours) ———

SELECT cron.schedule(
  'agent-kill-check',
  '*/15 14-21 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-kill-check',
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

-- ——— portfolio-report (daily post-close) ———

SELECT cron.schedule(
  'portfolio-report-daily',
  '15 20 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/portfolio-report',
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

-- ——— shipping-pulse-pull (weekly Monday) ———

SELECT cron.schedule(
  'shipping-pulse-pull',
  '15 14 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/shipping-pulse-pull',
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

-- ——— fetch-saas-revenue (weekly Monday) ———

SELECT cron.schedule(
  'fetch-saas-revenue-weekly',
  '5 6 * * 1',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/fetch-saas-revenue',
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

-- Inspection helpers:
-- SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
-- SELECT id, status_code, created, left(coalesce(content,''), 200)
--   FROM net._http_response WHERE created > now() - interval '1 hour'
--   ORDER BY created DESC;
