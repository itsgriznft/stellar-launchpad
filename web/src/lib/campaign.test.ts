import { describe, expect, it } from 'vitest';

import { ledgerOfCursor, MAX_WATCHED_CAMPAIGNS } from './campaign';

describe('ledgerOfCursor', () => {
  // Real cursors captured from soroban-rpc on testnet. The toid packs the
  // ledger sequence into its high 32 bits; getting this wrong makes the feed
  // either page forever or stop before it reaches the head.
  it.each([
    ['0015148538631553023-4294967295', 3_527_043],
    ['0014671969060388863-4294967295', 3_416_083],
  ])('reads the ledger out of %j', (cursor, ledger) => {
    expect(ledgerOfCursor(cursor)).toBe(ledger);
  });

  it('treats the first ledger of a sequence as that sequence', () => {
    // toid = ledger << 32, i.e. the very first event in the ledger.
    const toid = (1_000n << 32n).toString();
    expect(ledgerOfCursor(`${toid}-0`)).toBe(1_000);
  });

  it('falls back to zero rather than throwing on a cursor it cannot parse', () => {
    expect(ledgerOfCursor('')).toBe(0);
    expect(ledgerOfCursor('not-a-cursor')).toBe(0);
    expect(ledgerOfCursor('abc-1')).toBe(0);
  });
});

describe('MAX_WATCHED_CAMPAIGNS', () => {
  it('matches the RPC limit of 5 filters x 5 contract ids', () => {
    expect(MAX_WATCHED_CAMPAIGNS).toBe(25);
  });
});
