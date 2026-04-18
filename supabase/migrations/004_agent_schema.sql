-- Signal-only trading agent schema (see docs/agent-execution-plan.md).
-- Agent reads economic_data + predictions/verdicts, writes snapshots and digests.
-- No broker integration at this stage; digests are delivered to the human via email+Slack.

-- Singleton config row. Holds the enabled flag, mode, and deadman-switch state.
CREATE TABLE agent_config (
  id INT PRIMARY KEY DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  mode TEXT NOT NULL DEFAULT 'signal_only'
    CHECK (mode IN ('signal_only', 'auto_execute')),
  consecutive_failures INT NOT NULL DEFAULT 0,
  killed_reason TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (id = 1)
);

-- Raw snapshot of signal state + week-over-week drift at each tick.
-- One row per agent-tick invocation. Consumed by the digest generator.
CREATE TABLE agent_snapshots (
  tick_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tick_type TEXT NOT NULL CHECK (tick_type IN ('premarket', 'close', 'weekly')),
  signals JSONB NOT NULL,
  drift JSONB
);

-- Agent reasoning output: narrative + structured proposals for the human.
-- One row per tick; links back to the snapshot it was computed from.
CREATE TABLE agent_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tick_id UUID REFERENCES agent_snapshots(tick_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  tick_type TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('counterfactual_grind', 'inflection')),
  fired_count INT NOT NULL CHECK (fired_count BETWEEN 0 AND 5),
  kill_switch_triggered BOOLEAN NOT NULL DEFAULT FALSE,
  narrative TEXT NOT NULL,
  proposals JSONB NOT NULL,
  drift_notes TEXT,
  scorecard JSONB,
  delivered_email BOOLEAN DEFAULT FALSE,
  delivered_slack BOOLEAN DEFAULT FALSE
);

-- Public read policies match the other dashboard tables.
-- Writes remain service-role only (no INSERT/UPDATE/DELETE policies for anon).
ALTER TABLE agent_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON agent_config FOR SELECT USING (true);

ALTER TABLE agent_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON agent_snapshots FOR SELECT USING (true);

ALTER TABLE agent_digests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON agent_digests FOR SELECT USING (true);

-- Indexes for the two read patterns the dashboard uses:
--   /agent — most recent digests, filterable by tick_type
--   drift panel — snapshots ordered by taken_at
CREATE INDEX idx_agent_digests_created ON agent_digests(created_at DESC);
CREATE INDEX idx_agent_digests_tick_type ON agent_digests(tick_type, created_at DESC);
CREATE INDEX idx_agent_snapshots_taken ON agent_snapshots(taken_at DESC);

-- Seed the singleton config row.
INSERT INTO agent_config (id, enabled, mode)
VALUES (1, TRUE, 'signal_only')
ON CONFLICT (id) DO NOTHING;
