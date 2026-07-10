export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const RPC_URL = 'https://soroban-testnet.stellar.org';

/** Deployed by `scripts/deploy.sh` — see deployments/testnet.json. */
export const FACTORY_ID =
  import.meta.env.VITE_FACTORY_ID ?? 'CATTEK3T244RH3FR7REACNB3XXFCW4CG7R7U7WHPYPZM2H36NIP6R4JC';

/** Stellar Asset Contract for native XLM on testnet. */
export const NATIVE_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/**
 * Read-only calls are simulated, never submitted, but the RPC still wants a
 * source account that exists. Any funded testnet account works; this is the
 * launchpad admin. No secret key is involved.
 */
export const SIMULATION_SOURCE = 'GDGMCDU5HPC2Z7B6XO67IO5AZZR6NRITVS3E47WJ7LAQJBNAX2I2NJTC';

export const STROOPS_PER_XLM = 10_000_000n;

/**
 * Every Stellar account must keep a minimum balance on-chain (2 base reserves
 * = 1 XLM, plus 0.5 per subentry). Reserving a little more than that keeps a
 * contribution from failing at signing time over a few stroops of fees.
 */
export const RESERVE_BUFFER_STROOPS = 15_000_000n; // 1.5 XLM

/** Matches `MAX_TITLE_LEN` in the factory contract. */
export const MAX_TITLE_LEN = 64;

export const txUrl = (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const accountUrl = (id: string) => `https://stellar.expert/explorer/testnet/account/${id}`;
export const contractUrl = (id: string) => `https://stellar.expert/explorer/testnet/contract/${id}`;

export function formatXlm(stroops: bigint, maxDecimals = 4): string {
  const negative = stroops < 0n;
  const abs = negative ? -stroops : stroops;
  const whole = abs / STROOPS_PER_XLM;
  const frac = abs % STROOPS_PER_XLM;

  let fracText = frac.toString().padStart(7, '0').slice(0, maxDecimals).replace(/0+$/, '');
  fracText = fracText ? `.${fracText}` : '';
  return `${negative ? '-' : ''}${whole.toLocaleString('en-US')}${fracText}`;
}

/** Parse a user-typed XLM amount into stroops. Throws on anything malformed. */
export function parseXlm(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d*\.?\d*$/.test(trimmed) || trimmed === '' || trimmed === '.') {
    throw new Error('Enter a number, for example 25.5');
  }
  const [whole, frac = ''] = trimmed.split('.');
  if (frac.length > 7) throw new Error('XLM has at most 7 decimal places');
  return BigInt(whole || '0') * STROOPS_PER_XLM + BigInt((frac + '0000000').slice(0, 7));
}

export const shortAddress = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

export function timeLeft(deadline: bigint): string {
  const seconds = Number(deadline) - Math.floor(Date.now() / 1000);
  if (seconds <= 0) return 'Closed';

  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);

  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${minutes}m left`;
  return `${minutes}m left`;
}

/** Percent funded. A campaign can pass 100%, so callers clamp for display. */
export const percentFunded = (raised: bigint, goal: bigint): number =>
  goal > 0n ? Number((raised * 10_000n) / goal) / 100 : 0;

export const isClosed = (deadline: bigint): boolean => Number(deadline) * 1000 <= Date.now();
