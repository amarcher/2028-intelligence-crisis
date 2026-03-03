import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ARTICLE_CLAIMS } from '../lib/predictions';
import type { ArticleClaim, VerdictType } from '../lib/types';

interface DbPrediction {
  id: number;
  section: string;
  claim: string;
  metric: string | null;
  threshold: number | null;
  target_date: string | null;
  verdict: string;
  notes: string | null;
}

interface UsePredictionsResult {
  claims: ArticleClaim[];
  isLoading: boolean;
  error: string | null;
}

function dbRowToClaim(row: DbPrediction): ArticleClaim {
  return {
    id: `db-${row.id}`,
    section: row.section as ArticleClaim['section'],
    claim: row.claim,
    metric: row.metric || undefined,
    threshold: row.threshold || undefined,
    targetDate: row.target_date || undefined,
    verdict: row.verdict as VerdictType,
    notes: row.notes || undefined,
  };
}

export function usePredictions(): UsePredictionsResult {
  const [claims, setClaims] = useState<ArticleClaim[]>(ARTICLE_CLAIMS);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    let cancelled = false;

    async function fetchPredictions() {
      setIsLoading(true);
      setError(null);

      const { data: rows, error: queryError } = await supabase!
        .from('predictions')
        .select('*')
        .order('id', { ascending: true });

      if (cancelled) return;

      if (queryError) {
        setError(queryError.message);
        setIsLoading(false);
        return;
      }

      if (rows && rows.length > 0) {
        setClaims(rows.map(dbRowToClaim));
      }
      // If no rows, keep the client-side ARTICLE_CLAIMS fallback
      setIsLoading(false);
    }

    fetchPredictions();
    return () => { cancelled = true; };
  }, []);

  return { claims, isLoading, error };
}
