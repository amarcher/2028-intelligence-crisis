import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { DataPoint } from '../lib/types';

interface UseSupabaseOptions {
  startDate?: string;
}

interface UseSupabaseResult {
  data: DataPoint[] | null;
  isLoading: boolean;
  error: string | null;
}

export function useSupabase(seriesId: string, options?: UseSupabaseOptions): UseSupabaseResult {
  const [data, setData] = useState<DataPoint[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setIsLoading(false);
      setError('Supabase not configured');
      return;
    }

    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      let query = supabase!
        .from('economic_data')
        .select('date, value')
        .eq('series_id', seriesId)
        .order('date', { ascending: true });

      if (options?.startDate) {
        query = query.gte('date', options.startDate);
      }

      const { data: rows, error: queryError } = await query;

      if (cancelled) return;

      if (queryError) {
        setError(queryError.message);
        setIsLoading(false);
        return;
      }

      setData(
        (rows || []).map((row: { date: string; value: number }) => ({
          date: row.date,
          value: Number(row.value),
        }))
      );
      setIsLoading(false);
    }

    fetchData();
    return () => { cancelled = true; };
  }, [seriesId, options?.startDate]);

  return { data, isLoading, error };
}
