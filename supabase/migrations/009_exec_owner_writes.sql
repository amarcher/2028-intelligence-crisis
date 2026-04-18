-- Owner-only write policies for the execution-mode surfaces.
-- Same ownership model as 007_agent_auth.sql: authenticated users whose JWT
-- email matches agent_config.owner_email can perform the write.
--
-- Updates allowed:
--   agent_config.phase                  — promote/demote the phase gate
--   agent_config.paper_mode             — toggle paper/live
--   agent_config.halted + halt_reason   — resume after a kill
--   agent_approvals.status              — approve/reject pending items
--
-- Service role writes remain unrestricted. Anon reads stay as-is (public read
-- policies from 004 + 008 still apply).
-- Idempotent.

-- We can't easily scope column-level UPDATE permissions through RLS alone
-- without extending the policy to include an EXISTS check against
-- agent_config.owner_email. The existing policy "Owner can update" from 007
-- already covers agent_config at row level — any owner UPDATE on id=1 passes.
-- So the phase / paper_mode / halted changes work without a new policy,
-- *provided the existing policy is present*. Re-assert defensively:

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'agent_config' AND policyname = 'Owner can update'
  ) THEN
    CREATE POLICY "Owner can update"
      ON agent_config
      FOR UPDATE
      TO authenticated
      USING (owner_email IS NOT NULL AND auth.jwt() ->> 'email' = owner_email)
      WITH CHECK (owner_email IS NOT NULL AND auth.jwt() ->> 'email' = owner_email);
  END IF;
END $$;

-- Owner can update approvals (approve/reject).
-- Scoped to the singleton owner via the same expression against
-- agent_config.owner_email so approvals can't drift out of sync.
DROP POLICY IF EXISTS "Owner can update approval" ON agent_approvals;
CREATE POLICY "Owner can update approval"
  ON agent_approvals
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM agent_config
      WHERE id = 1
        AND owner_email IS NOT NULL
        AND auth.jwt() ->> 'email' = owner_email
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM agent_config
      WHERE id = 1
        AND owner_email IS NOT NULL
        AND auth.jwt() ->> 'email' = owner_email
    )
  );
