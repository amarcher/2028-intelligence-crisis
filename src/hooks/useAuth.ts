import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface UseAuthResult {
  session: Session | null;
  email: string | null;
  loading: boolean;
  signInWithEmail: (email: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => Promise<void>;
}

export function useAuth(): UseAuthResult {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(() => Boolean(supabase));

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signInWithEmail = async (email: string) => {
    if (!supabase) return { ok: false as const, error: 'Supabase not configured' };
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Returns the user to the agent section after clicking the magic link.
        emailRedirectTo: `${window.location.origin}/#section-agent`,
      },
    });
    if (error) return { ok: false as const, error: error.message };
    return { ok: true as const };
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  return {
    session,
    email: session?.user?.email ?? null,
    loading,
    signInWithEmail,
    signOut,
  };
}
