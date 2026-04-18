import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AgentConfig, AgentDigest } from '../lib/types';

interface UseAgentDataResult {
  digests: AgentDigest[];
  config: AgentConfig | null;
  isLoading: boolean;
  error: string | null;
}

const DIGEST_LIMIT = 15;

export function useAgentData(): UseAgentDataResult {
  const [digests, setDigests] = useState<AgentDigest[]>([]);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setError('Supabase not configured');
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);

      const [digestRes, configRes] = await Promise.all([
        supabase!
          .from('agent_digests')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(DIGEST_LIMIT),
        supabase!.from('agent_config').select('*').eq('id', 1).single(),
      ]);

      if (cancelled) return;

      if (digestRes.error) {
        setError(`digests: ${digestRes.error.message}`);
      } else {
        setDigests((digestRes.data ?? []) as AgentDigest[]);
      }

      if (configRes.error) {
        // No config row yet is a plausible non-error state during setup.
        setConfig(null);
      } else {
        setConfig(configRes.data as AgentConfig);
      }

      setIsLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { digests, config, isLoading, error };
}
