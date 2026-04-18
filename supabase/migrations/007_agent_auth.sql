-- Owner auth for agent_config writes.
-- Strategy: singleton agent_config row owns a single owner_email. Authenticated
-- users whose JWT email matches can UPDATE the row (mute/enable, reset
-- deadman). Any other authenticated user can't. Unauthenticated can't.
-- WITH CHECK uses the same expression so the owner_email field can't be
-- escalated by a non-service-role user.
--
-- After applying this migration, seed your email (one-off, service role):
--   UPDATE agent_config SET owner_email = '<your-email>' WHERE id = 1;
--
-- Idempotent.

ALTER TABLE agent_config ADD COLUMN IF NOT EXISTS owner_email TEXT;

DROP POLICY IF EXISTS "Owner can update" ON agent_config;
CREATE POLICY "Owner can update"
  ON agent_config
  FOR UPDATE
  TO authenticated
  USING (owner_email IS NOT NULL AND auth.jwt() ->> 'email' = owner_email)
  WITH CHECK (owner_email IS NOT NULL AND auth.jwt() ->> 'email' = owner_email);
