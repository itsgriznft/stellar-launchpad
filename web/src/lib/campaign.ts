import { nativeToScVal, rpc, scValToNative, type xdr } from '@stellar/stellar-sdk';

import { NATIVE_SAC } from '../config';
import { addressArg, invoke, server, simulate, type Signer, type TxProgress } from './rpc';

export interface CampaignState {
  token: string;
  recipient: string;
  title: string;
  goal: bigint;
  deadline: bigint;
  raised: bigint;
  contributors: number;
  withdrawn: boolean;
}

export interface ContributionEvent {
  id: string;
  txHash: string;
  ledger: number;
  at: Date;
  campaign: string;
  contributor: string;
  amount: bigint;
  raised: bigint;
}

export async function readCampaignState(campaign: string): Promise<CampaignState> {
  const raw = (await simulate(campaign, 'state')) as Record<string, unknown>;
  return {
    token: String(raw.token),
    recipient: String(raw.recipient),
    title: String(raw.title),
    goal: BigInt(raw.goal as bigint),
    deadline: BigInt(raw.deadline as bigint),
    raised: BigInt(raw.raised as bigint),
    contributors: Number(raw.contributors),
    withdrawn: Boolean(raw.withdrawn),
  };
}

export async function readContribution(campaign: string, address: string): Promise<bigint> {
  return BigInt((await simulate(campaign, 'contribution', addressArg(address))) as bigint);
}

/** Native XLM balance of an account, in stroops, read through the token contract. */
export async function readBalance(address: string): Promise<bigint> {
  return BigInt((await simulate(NATIVE_SAC, 'balance', addressArg(address))) as bigint);
}

export async function contribute(
  campaign: string,
  contributor: string,
  amountStroops: bigint,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<string> {
  const { hash } = await invoke(
    contributor,
    campaign,
    'contribute',
    [addressArg(contributor), nativeToScVal(amountStroops, { type: 'i128' })],
    sign,
    onStage,
  );
  return hash;
}

// ---------------------------------------------------------------- events

/** Roughly 24 hours at ~5s per ledger — what the activity feed backfills. */
const FEED_WINDOW_LEDGERS = 17_280;

/**
 * A single `getEvents` call scans about 10k ledgers before stopping and handing
 * back a cursor, so the feed window takes two pages. The cap is slack for a
 * client that fell behind, not a normal cost.
 */
const MAX_PAGES = 8;

/** The RPC accepts at most 5 event filters, each naming at most 5 contracts. */
const IDS_PER_FILTER = 5;
const MAX_FILTERS = 5;
export const MAX_WATCHED_CAMPAIGNS = IDS_PER_FILTER * MAX_FILTERS;

/**
 * Contribution events across the given campaigns, newest first.
 *
 * Pass the `cursor` from the previous call to fetch only what happened since;
 * omit it to backfill the recent window. Either way this pages forward until it
 * catches up with the current ledger.
 *
 * The feed deliberately does not backfill the RPC's full retention window: that
 * is ~120k ledgers, a dozen round trips, and seconds of latency before anything
 * renders. Campaign totals come from `state()`, which is always exact.
 *
 * At most `MAX_WATCHED_CAMPAIGNS` campaigns can be watched at once — the RPC's
 * own filter limit. Callers past that point get events for the first few only,
 * and `watched` reports how many were actually subscribed to.
 */
export async function readContributionEvents(
  campaigns: string[],
  cursor?: string,
): Promise<{ events: ContributionEvent[]; cursor: string; watched: number }> {
  if (campaigns.length === 0) return { events: [], cursor: cursor ?? '', watched: 0 };

  const watched = campaigns.slice(0, MAX_WATCHED_CAMPAIGNS);
  const filters = eventFilters(watched);
  let next = cursor;
  let startLedger = next ? undefined : await feedStartLedger(filters);
  const collected: ContributionEvent[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = next
      ? await server.getEvents({ cursor: next, filters, limit: 200 })
      : await server.getEvents({ startLedger: startLedger!, filters, limit: 200 });

    collected.push(...response.events.filter(isContribution).map(toContributionEvent));

    if (!response.cursor) break;
    next = response.cursor;
    startLedger = undefined;

    // Caught up with the head of the chain; nothing more to page through.
    if (ledgerOfCursor(response.cursor) >= response.latestLedger) break;
  }

  return { events: collected, cursor: next ?? '', watched: watched.length };
}

/** Split the contract ids across as many filters as the RPC will accept. */
function eventFilters(campaigns: string[]): rpc.Api.EventFilter[] {
  const filters: rpc.Api.EventFilter[] = [];
  for (let index = 0; index < campaigns.length; index += IDS_PER_FILTER) {
    filters.push({ type: 'contract', contractIds: campaigns.slice(index, index + IDS_PER_FILTER) });
  }
  return filters;
}

const isContribution = (event: rpc.Api.EventResponse) => topicSymbol(event.topic[0]) === 'contributed';

function toContributionEvent(event: rpc.Api.EventResponse): ContributionEvent {
  const data = scValToNative(event.value) as { amount: bigint; raised: bigint };
  return {
    id: event.id,
    txHash: event.txHash,
    ledger: event.ledger,
    at: new Date(event.ledgerClosedAt),
    campaign: String(event.contractId),
    contributor: String(scValToNative(event.topic[1])),
    amount: BigInt(data.amount),
    raised: BigInt(data.raised),
  };
}

function topicSymbol(topic: xdr.ScVal | undefined): string | undefined {
  if (!topic) return undefined;
  try {
    return String(scValToNative(topic));
  } catch {
    return undefined;
  }
}

/**
 * A cursor is `<toid>-<index>`, and the ledger sits in the toid's high 32 bits.
 *
 * Reading this wrong makes the feed page forever or stop early, so it is
 * exported for tests.
 */
export function ledgerOfCursor(cursor: string): number {
  try {
    return Number(BigInt(cursor.split('-')[0]) >> 32n);
  } catch {
    return 0;
  }
}

/**
 * Where the feed starts reading.
 *
 * The RPC rejects a `startLedger` older than its retention window, and only
 * reveals that window's bounds inside a `getEvents` response — so ask about the
 * current ledger first and read `oldestLedger` off the reply, then walk back at
 * most one feed window from the head.
 */
async function feedStartLedger(filters: rpc.Api.EventFilter[]): Promise<number> {
  const latest = await server.getLatestLedger();
  const probe = await server.getEvents({ startLedger: latest.sequence, filters, limit: 1 });
  return Math.max(probe.oldestLedger, latest.sequence - FEED_WINDOW_LEDGERS, 1);
}
