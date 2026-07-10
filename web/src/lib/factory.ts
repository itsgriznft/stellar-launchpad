import { nativeToScVal } from '@stellar/stellar-sdk';

import { FACTORY_ID } from '../config';
import { addressArg, invoke, simulate, type Signer, type TxProgress } from './rpc';

/** One row of the launchpad listing, as returned by `Factory::listing`. */
export interface Listing {
  address: string;
  title: string;
  creator: string;
  goal: bigint;
  raised: bigint;
  deadline: bigint;
  contributors: number;
  withdrawn: boolean;
}

/**
 * Totals across the campaigns, as returned by `Factory::stats`.
 *
 * The contract caps how many campaigns it visits per call. When `aggregated`
 * is below `campaigns`, the totals cover only that many — a lower bound.
 */
export interface Stats {
  campaigns: number;
  aggregated: number;
  totalRaised: bigint;
  totalGoal: bigint;
  funded: number;
}

/** Every campaign, as one cross-contract `state()` call per campaign. */
export async function readListing(start = 0, limit = 50): Promise<Listing[]> {
  const rows = (await simulate(
    FACTORY_ID,
    'listing',
    nativeToScVal(start, { type: 'u32' }),
    nativeToScVal(limit, { type: 'u32' }),
  )) as Record<string, unknown>[];

  return rows.map((row) => ({
    address: String(row.address),
    title: String(row.title),
    creator: String(row.creator),
    goal: BigInt(row.goal as bigint),
    raised: BigInt(row.raised as bigint),
    deadline: BigInt(row.deadline as bigint),
    contributors: Number(row.contributors),
    withdrawn: Boolean(row.withdrawn),
  }));
}

export async function readStats(): Promise<Stats> {
  const raw = (await simulate(FACTORY_ID, 'stats')) as Record<string, unknown>;
  return {
    campaigns: Number(raw.campaigns),
    aggregated: Number(raw.aggregated),
    totalRaised: BigInt(raw.total_raised as bigint),
    totalGoal: BigInt(raw.total_goal as bigint),
    funded: Number(raw.funded),
  };
}

/**
 * Deploy a new campaign contract through the factory.
 *
 * Returns the address of the campaign the factory just created — the value the
 * `create` call itself returned, not a guess.
 */
export async function createCampaign(
  creator: string,
  title: string,
  goalStroops: bigint,
  deadlineSeconds: bigint,
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<{ hash: string; address: string }> {
  const { hash, returnValue } = await invoke(
    creator,
    FACTORY_ID,
    'create',
    [
      addressArg(creator),
      nativeToScVal(title, { type: 'string' }),
      nativeToScVal(goalStroops, { type: 'i128' }),
      nativeToScVal(deadlineSeconds, { type: 'u64' }),
    ],
    sign,
    onStage,
  );

  return { hash, address: String(returnValue) };
}
