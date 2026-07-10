import { useCallback, useEffect, useRef, useState } from 'react';

import { AppError, classifyError } from '../lib/errors';
import { readListing, readStats, type Listing, type Stats } from '../lib/factory';

const POLL_MS = 6_000;

export interface Launchpad {
  listing: Listing[];
  stats: Stats | null;
  /** True only until the first successful read; polls never blank the page. */
  loading: boolean;
  error: AppError | null;
  syncedAt: Date | null;
  refresh: () => void;
}

/**
 * Keeps the campaign list and the aggregate stats in sync with the ledger.
 *
 * Both come from the factory, which fans out one cross-contract `state()` call
 * per campaign. A failed poll leaves the last good data on screen.
 */
export function useLaunchpad(): Launchpad {
  const [listing, setListing] = useState<Listing[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  const inFlight = useRef(false);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const [rows, totals] = await Promise.all([readListing(), readStats()]);
      setListing(rows);
      setStats(totals);
      setError(null);
      setSyncedAt(new Date());
    } catch (caught) {
      setError(classifyError(caught));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  return { listing, stats, loading, error, syncedAt, refresh: () => void poll() };
}
