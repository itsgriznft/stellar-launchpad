import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readCampaignState,
  readContributionEvents,
  type CampaignState,
  type ContributionEvent,
} from '../lib/campaign';
import { AppError, classifyError } from '../lib/errors';

const POLL_MS = 5_000;

export interface Campaign {
  state: CampaignState | null;
  events: ContributionEvent[];
  loading: boolean;
  error: AppError | null;
  syncedAt: Date | null;
  refresh: () => void;
}

/**
 * Watches one campaign: its state, and the contributions arriving to it.
 *
 * State is re-read on every tick; events are pulled forward from a cursor so
 * each poll only transfers what is new. The first event fetch backfills a day
 * of history and takes a couple of round trips, so it must not block the
 * progress bar from rendering.
 */
export function useCampaign(address: string): Campaign {
  const [state, setState] = useState<CampaignState | null>(null);
  const [events, setEvents] = useState<ContributionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  const cursor = useRef<string | undefined>(undefined);
  const seen = useRef(new Set<string>());
  const inFlight = useRef(false);

  // A different campaign means a different feed; drop everything we cached.
  useEffect(() => {
    cursor.current = undefined;
    seen.current = new Set();
    setState(null);
    setEvents([]);
    setLoading(true);
    setError(null);
    setSyncedAt(null);
  }, [address]);

  const poll = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const statePromise = readCampaignState(address).then((next) => {
        setState(next);
        setLoading(false);
      });

      const feedPromise = readContributionEvents([address], cursor.current).then((feed) => {
        const fresh = feed.events.filter((event) => !seen.current.has(event.id));
        if (fresh.length > 0) {
          fresh.forEach((event) => seen.current.add(event.id));
          setEvents((current) => [...fresh, ...current].sort((a, b) => b.ledger - a.ledger));
        }
        if (feed.cursor) cursor.current = feed.cursor;
      });

      await Promise.all([statePromise, feedPromise]);

      setError(null);
      setSyncedAt(new Date());
    } catch (caught) {
      setError(classifyError(caught));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  return { state, events, loading, error, syncedAt, refresh: () => void poll() };
}
