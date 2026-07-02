-- M1: exit engine + risk overhaul (roadmap docs/active-roadmap-v2.md).
-- Idempotent — safe to re-run.
--
-- 1. agent_position_rules — per-option-position exit rules (stop-loss,
--    rule-of-thirds profit ladder, LEAPS roll alerting). Evaluated and
--    ENFORCED daily by the new agent-exit-check function. Exits were
--    previously prose in Slack messages that nothing ever evaluated — a DDOG
--    put bled to −96% with no stop while a CRM winner had no ladder tracking.
-- 2. agent_config.active_sleeve_budget_pct — sleeve budget as % of equity,
--    default 50 for the paper-aggressive phase (was hardcoded 20). The old
--    "SaaS puts may not exceed AI longs + defensives" symmetry rule is
--    retired in code; the budget is now the only sizing gate.
-- 3. Cron: agent-exit-check daily at 15:00 UTC (11:00 EDT / 10:00 EST — in
--    market hours in both DST regimes).

-- ————— 1. position exit rules —————

CREATE TABLE IF NOT EXISTS agent_position_rules (
  option_symbol TEXT PRIMARY KEY,          -- OCC symbol
  ticker TEXT NOT NULL,                    -- underlying
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Close the position when unrealized P&L (% of entry) breaches this.
  stop_loss_pct NUMERIC NOT NULL DEFAULT -65,
  -- Rule of thirds: sell 1/3 at tier1× entry, 1/3 at tier2× entry.
  tier1_multiple NUMERIC NOT NULL DEFAULT 2.0,
  tier2_multiple NUMERIC NOT NULL DEFAULT 4.0,
  tier1_done BOOLEAN NOT NULL DEFAULT FALSE,
  tier2_done BOOLEAN NOT NULL DEFAULT FALSE,
  -- Slack a roll suggestion when the option has fewer days than this left.
  roll_alert_dte INT NOT NULL DEFAULT 90,
  roll_alerted_at TIMESTAMPTZ,
  last_evaluated_at TIMESTAMPTZ,
  notes TEXT
);

ALTER TABLE agent_position_rules ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_position_rules' AND policyname = 'Public read') THEN
    CREATE POLICY "Public read" ON agent_position_rules FOR SELECT USING (true);
  END IF;
END $$;

-- ————— 2. sleeve budget —————

ALTER TABLE agent_config
  ADD COLUMN IF NOT EXISTS active_sleeve_budget_pct NUMERIC NOT NULL DEFAULT 50;

-- ————— 3. exit-check cron —————

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'agent-exit-check',
  '0 15 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://ppxlpanujqticegujomt.supabase.co/functions/v1/agent-exit-check',
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
