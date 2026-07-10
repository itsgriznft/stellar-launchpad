import { describe, expect, it } from 'vitest';

import { AppError, classifyError } from './errors';

describe('classifyError', () => {
  it('passes AppError through untouched', () => {
    const original = new AppError('NETWORK', 'boom');
    expect(classifyError(original)).toBe(original);
  });

  it.each([
    ['User declined access', 'Freighter'],
    ['The user rejected the transaction', 'xBull'],
    ['Action canceled by the user', 'Albedo'],
  ])('reads %j as a rejection', (message) => {
    expect(classifyError(new Error(message)).kind).toBe('USER_REJECTED');
  });

  it.each([
    'Freighter is not connected',
    "D'CENT Stellar provider is not available",
    'Rabet is not installed',
  ])('reads %j as a missing wallet', (message) => {
    expect(classifyError(new Error(message)).kind).toBe('WALLET_NOT_FOUND');
  });

  it('maps the token contract BalanceError to insufficient balance', () => {
    const simulation = 'HostError: Error(Contract, #10)\n  Event log: transfer failed';
    expect(classifyError(new Error(simulation)).kind).toBe('INSUFFICIENT_BALANCE');
  });

  it('prefers the token BalanceError over our own error in the same diagnostic chain', () => {
    // A failing `contribute` reports the token's error and ours; the token's is
    // the actual cause, and #3 is only what our contract raised on the way out.
    const chain = 'Error(Contract, #3), caused by Error(Contract, #10)';
    expect(classifyError(new Error(chain)).kind).toBe('INSUFFICIENT_BALANCE');
  });

  it('maps our own contract error codes to their meaning', () => {
    const error = classifyError(new Error('HostError: Error(Contract, #4)'));
    expect(error.kind).toBe('CONTRACT_REJECTED');
    expect(error.message).toBe('This campaign has already ended.');
  });

  it('keeps the original text when nothing matches', () => {
    expect(classifyError(new Error('sunspots')).kind).toBe('UNKNOWN');
    expect(classifyError(new Error('sunspots')).message).toBe('sunspots');
  });

  it('handles throws that are not Errors', () => {
    expect(classifyError('user rejected').kind).toBe('USER_REJECTED');
    expect(classifyError({ message: 'not installed' }).kind).toBe('WALLET_NOT_FOUND');
  });
});
