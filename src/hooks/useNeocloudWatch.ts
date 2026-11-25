import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { PolicyEvent, PricePoint } from '../lib/eventStudy';

export interface OddsLatest {
  venue: string;
  market_ticker: string;
  observed_at: string;
  yes_price: number | null;
  yes_bid: number | null;
  yes_ask: number | null;
  volume: number | null;
  close_time: string | null;
}

export interface ScrapeRun {
  source: string;
  status: string;
  rows: number | null;
  ran_at: string;
}

interface NeocloudWatchResult {
  prices: PricePoint[];
  events: PolicyEvent[];
  odds: OddsLatest[];
  lastRuns: ScrapeRun[];
  isLoading: boolean;
  error: string | null;
  isEmpty: boolean;
}

export function useNeocloudWatch(): NeocloudWatchResult {
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [events, setEvents] = useState<PolicyEvent[]>([]);
  const [odds, setOdds] = useState<OddsLatest[]>([]);
  const [lastRuns, setLastRuns] = useState<ScrapeRun[]>([]);
  const [isLoading, setIsLoading] = useState(() => Boolean(supabase));
  const [error, setError] = useState<string | null>(() => (supabase ? null : 'Supabase not configured'));

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);

      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 1);

      const [priceRes, eventRes, oddsRes, logRes] = await Promise.all([
        supabase!
          .from('market_prices')
          .select('ticker, trade_date, close')
          .gte('trade_date', cutoff.toISOString().slice(0, 10))
          .order('trade_date', { ascending: true })
          .limit(5000),
        supabase!.from('policy_events').select('event_date, kind, label, source_url'),
        supabase!
          .from('prediction_odds_latest')
          .select('venue, market_ticker, observed_at, yes_price, yes_bid, yes_ask, volume, close_time'),
        supabase!
          .from('neocloud_scrape_log')
          .select('source, status, rows, ran_at')
          .order('ran_at', { ascending: false })
          .limit(10),
      ]);

      if (cancelled) return;

      setPrices(((priceRes.data ?? []) as PricePoint[]).map((p) => ({ ...p, close: Number(p.close) })));
      setEvents((eventRes.data ?? []) as PolicyEvent[]);
      setOdds((oddsRes.data ?? []) as OddsLatest[]);
      setLastRuns((logRes.data ?? []) as ScrapeRun[]);
      setError(
        priceRes.error?.message ?? eventRes.error?.message ?? oddsRes.error?.message ?? logRes.error?.message ?? null,
      );
      setIsLoading(false);
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return { prices, events, odds, lastRuns, isLoading, error, isEmpty: !isLoading && prices.length === 0 };
}
