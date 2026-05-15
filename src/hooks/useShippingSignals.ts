import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface LatestSignal {
  source: string;
  metric: string;
  observed_at: string;
  value: number;
  unit: string;
  meta: Record<string, unknown> | null;
}

export interface HistoryPoint {
  source: string;
  metric: string;
  observed_at: string;
  value: number;
}

export interface SourceStatus {
  source: string;
  last_ok_at: string | null;
  last_run_at: string | null;
  consecutive_failures: number;
  fresh: boolean;
}

interface ShippingSignalsResult {
  latest: LatestSignal[];
  history: HistoryPoint[];
  sourceStatus: SourceStatus[];
  isLoading: boolean;
  error: string | null;
  isEmpty: boolean;
}

// Roll up to weekly Mondays so 2y of BDRY daily data doesn't flood charts.
// Returns last value seen within each ISO week.
function weeklyBucket<T extends HistoryPoint>(rows: T[]): T[] {
  const byWeek = new Map<string, T>();
  for (const r of rows) {
    const d = new Date(r.observed_at);
    if (Number.isNaN(d.getTime())) continue;
    // ISO week key: year + week number
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
    const key = `${r.source}::${r.metric}::${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    byWeek.set(key, r);
  }
  return Array.from(byWeek.values()).sort((a, b) =>
    a.observed_at.localeCompare(b.observed_at),
  );
}

export function useShippingSignals(): ShippingSignalsResult {
  const [latest, setLatest] = useState<LatestSignal[]>([]);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus[]>([]);
  const [isLoading, setIsLoading] = useState(() => Boolean(supabase));
  const [error, setError] = useState<string | null>(() =>
    supabase ? null : 'Supabase not configured',
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);

      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 2); // 104-week window

      const [latestRes, histRes, statusRes] = await Promise.all([
        supabase!
          .from('shipping_signals_latest')
          .select('source, metric, observed_at, value, unit, meta'),
        supabase!
          .from('shipping_signals')
          .select('source, metric, observed_at, value')
          .gte('observed_at', cutoff.toISOString())
          .order('observed_at', { ascending: true })
          .limit(5000),
        supabase!
          .from('shipping_signal_source_status')
          .select('source, last_ok_at, last_run_at, consecutive_failures, fresh'),
      ]);

      if (cancelled) return;

      const firstError =
        latestRes.error?.message ??
        histRes.error?.message ??
        statusRes.error?.message ??
        null;

      setLatest((latestRes.data ?? []) as LatestSignal[]);
      setHistory(weeklyBucket((histRes.data ?? []) as HistoryPoint[]));
      setSourceStatus((statusRes.data ?? []) as SourceStatus[]);
      setError(firstError);
      setIsLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    latest,
    history,
    sourceStatus,
    isLoading,
    error,
    isEmpty: !isLoading && latest.length === 0,
  };
}
