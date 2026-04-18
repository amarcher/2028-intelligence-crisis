import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AgentApproval, AgentConfig, AgentDigest, AgentOrder } from '../lib/types';

interface UseAgentDataResult {
  digests: AgentDigest[];
  config: AgentConfig | null;
  approvals: AgentApproval[];
  orders: AgentOrder[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const DIGEST_LIMIT = 15;
const ORDER_LIMIT = 25;
const APPROVAL_LIMIT = 10;

export function useAgentData(): UseAgentDataResult {
  const [digests, setDigests] = useState<AgentDigest[]>([]);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [approvals, setApprovals] = useState<AgentApproval[]>([]);
  const [orders, setOrders] = useState<AgentOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabase) {
      setError('Supabase not configured');
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const [digestRes, configRes, approvalRes, orderRes] = await Promise.all([
      supabase
        .from('agent_digests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(DIGEST_LIMIT),
      supabase.from('agent_config').select('*').eq('id', 1).single(),
      supabase
        .from('agent_approvals')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(APPROVAL_LIMIT),
      supabase
        .from('agent_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(ORDER_LIMIT),
    ]);

    if (digestRes.error) {
      setError(`digests: ${digestRes.error.message}`);
    } else {
      setDigests((digestRes.data ?? []) as AgentDigest[]);
    }

    if (configRes.error) {
      setConfig(null);
    } else {
      setConfig(configRes.data as AgentConfig);
    }

    // Approvals and orders tables may not exist until migration 008 runs;
    // treat absent-table as empty rather than fatal.
    setApprovals(approvalRes.error ? [] : ((approvalRes.data ?? []) as AgentApproval[]));
    setOrders(orderRes.error ? [] : ((orderRes.data ?? []) as AgentOrder[]));

    setIsLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().catch(() => {
      if (!cancelled) setError('load failed');
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  return { digests, config, approvals, orders, isLoading, error, refetch: load };
}
