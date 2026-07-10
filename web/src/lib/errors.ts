/**
 * Everything that can go wrong between a click and a ledger entry, reduced to a
 * handful of kinds the UI knows how to explain.
 */
export type ErrorKind =
  | 'WALLET_NOT_FOUND'
  | 'USER_REJECTED'
  | 'INSUFFICIENT_BALANCE'
  | 'ACCOUNT_NOT_FUNDED'
  | 'CONTRACT_REJECTED'
  | 'NETWORK'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly kind: ErrorKind;
  readonly hint?: string;

  constructor(kind: ErrorKind, message: string, hint?: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'AppError';
    this.kind = kind;
    this.hint = hint;
  }
}

/** Error codes returned by our own crowdfund contract (`Error` enum in lib.rs). */
const CONTRACT_ERRORS: Record<number, string> = {
  1: 'The campaign goal must be positive.',
  2: 'The campaign deadline must be in the future.',
  3: 'Contribution amount must be greater than zero.',
  4: 'This campaign has already ended.',
  5: 'The campaign is still running.',
  6: 'The campaign did not reach its goal.',
  7: 'The campaign reached its goal, so contributions cannot be refunded.',
  8: 'The funds were already withdrawn.',
  9: 'You have nothing to refund.',
};

/**
 * The Stellar Asset Contract's `BalanceError`, raised when a `transfer` would
 * take an account below what it is allowed to spend.
 * @see https://developers.stellar.org/docs/tokens/stellar-asset-contract
 */
const SAC_BALANCE_ERROR = 10;

const REJECTED = /reject|declin|denied|cancel|user closed|dismiss|not allowed/i;
const NOT_FOUND = /not (connected|installed|available|found)|no wallet|provider is not|unavailable/i;
const NETWORK = /network error|failed to fetch|timeout|econnrefused|502|503|504/i;

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

/**
 * Map an arbitrary throw from the wallet kit, the RPC, or the contract onto an
 * `AppError`. Anything unrecognised keeps its original text rather than being
 * flattened into a generic "something went wrong".
 */
export function classifyError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  const raw = messageOf(error);

  if (REJECTED.test(raw)) {
    return new AppError(
      'USER_REJECTED',
      'You rejected the request in your wallet.',
      'Nothing was sent to the network. Try again when ready.',
      error,
    );
  }

  if (NOT_FOUND.test(raw)) {
    return new AppError(
      'WALLET_NOT_FOUND',
      'That wallet is not available in this browser.',
      'Install the extension (or pick another wallet) and reload the page.',
      error,
    );
  }

  // A failing call reports the whole diagnostic chain, so the token's error and
  // ours can both appear. The token's BalanceError is the more specific cause.
  const codes = contractErrorCodes(raw);

  if (codes.includes(SAC_BALANCE_ERROR)) {
    return new AppError(
      'INSUFFICIENT_BALANCE',
      'Your account does not have enough XLM for this contribution.',
      'Fund it from the testnet friendbot, or contribute a smaller amount.',
      error,
    );
  }

  const ours = codes.find((code) => code in CONTRACT_ERRORS);
  if (ours !== undefined) {
    return new AppError('CONTRACT_REJECTED', CONTRACT_ERRORS[ours], undefined, error);
  }

  if (/account not found|was not found/i.test(raw)) {
    return new AppError(
      'ACCOUNT_NOT_FUNDED',
      'This account does not exist on testnet yet.',
      'Fund it with friendbot first, then reconnect.',
      error,
    );
  }

  if (NETWORK.test(raw)) {
    return new AppError('NETWORK', 'Could not reach the Stellar network.', 'Check your connection and retry.', error);
  }

  return new AppError('UNKNOWN', raw || 'Something went wrong.', undefined, error);
}

/** Pull every `N` out of host errors like `Error(Contract, #10)`. */
function contractErrorCodes(raw: string): number[] {
  return [...raw.matchAll(/Error\(Contract,\s*#(\d+)\)/g)].map((match) => Number(match[1]));
}
