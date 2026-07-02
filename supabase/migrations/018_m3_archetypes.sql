-- M3: aggressive paper archetypes (roadmap docs/active-roadmap-v2.md).
-- Idempotent — safe to re-run.
--
-- agent_position_rules gains archetype + force_close_date:
--   - archetype: 'core' (standing book), 'earnings_window' (pre-print put /
--     spread, force-closed 2 trading days after the report), or
--     'tactical_inverse' (SQQQ/SPXS, 5-trading-day window, 2% hard cap).
--   - force_close_date: the exit engine closes the position on the first
--     daily check on/after this date, win or lose. Written by the executor
--     from the proposal's time_stop.
-- No new crons — the M1 agent-exit-check cron enforces these.

ALTER TABLE agent_position_rules
  ADD COLUMN IF NOT EXISTS archetype TEXT NOT NULL DEFAULT 'core'
    CHECK (archetype IN ('core', 'earnings_window', 'tactical_inverse')),
  ADD COLUMN IF NOT EXISTS force_close_date DATE;
