import { useEffect, useState, useRef } from 'react';
import { syncNtpClock, startNtpAutoResync, getServerTime, getNtpOffset } from '../lib/ntp';

interface NtpState {
  offset: number;
  synced: boolean;
  syncError: string | null;
}

export function useNtpSync(): NtpState & { getServerTime: () => number } {
  const [state, setState] = useState<NtpState>({
    offset: 0,
    synced: false,
    syncError: null,
  });
  const stopResyncRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    syncNtpClock()
      .then((offset) => {
        if (cancelled) return;
        setState({ offset, synced: true, syncError: null });
        // Start background re-sync
        stopResyncRef.current = startNtpAutoResync();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn('[useNtpSync] initial sync failed:', msg);
        // Still mark as synced with offset=0 so the app can start
        setState({ offset: 0, synced: true, syncError: msg });
      });

    return () => {
      cancelled = true;
      stopResyncRef.current?.();
    };
  }, []);

  // Keep offset in sync after background re-syncs
  useEffect(() => {
    const id = setInterval(() => {
      const current = getNtpOffset();
      setState((s) => (s.offset !== current ? { ...s, offset: current } : s));
    }, 5_000);
    return () => clearInterval(id);
  }, []);

  return { ...state, getServerTime };
}
