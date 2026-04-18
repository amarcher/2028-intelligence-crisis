-- Add Anthropic API cost tracking to agent_digests.
-- Captured from the Messages API usage object on each tick.
-- Idempotent: safe to re-run.

ALTER TABLE agent_digests
  ADD COLUMN IF NOT EXISTS cost_input_tokens INT,
  ADD COLUMN IF NOT EXISTS cost_output_tokens INT,
  ADD COLUMN IF NOT EXISTS cost_cache_read_tokens INT,
  ADD COLUMN IF NOT EXISTS cost_cache_creation_tokens INT,
  ADD COLUMN IF NOT EXISTS cost_model TEXT,
  ADD COLUMN IF NOT EXISTS reasoner_status TEXT
    CHECK (reasoner_status IN ('ok', 'retried_ok', 'fallback_skeleton', 'fallback_unavailable'));

-- Convenience view for monthly cost visibility.
-- Uses Anthropic's list pricing (pre-cache) as rough USD; update if pricing changes.
CREATE OR REPLACE VIEW agent_monthly_cost AS
SELECT
  date_trunc('month', created_at) AS month,
  cost_model,
  COUNT(*) AS tick_count,
  SUM(cost_input_tokens) AS total_input_tokens,
  SUM(cost_output_tokens) AS total_output_tokens,
  SUM(cost_cache_read_tokens) AS total_cache_read_tokens,
  SUM(cost_cache_creation_tokens) AS total_cache_creation_tokens,
  ROUND(
    (SUM(cost_input_tokens) * 5.0
     + SUM(cost_output_tokens) * 25.0
     + SUM(cost_cache_read_tokens) * 0.5
     + SUM(cost_cache_creation_tokens) * 6.25
    ) / 1000000.0, 4
  ) AS est_usd_opus_47
FROM agent_digests
WHERE cost_model IS NOT NULL
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
