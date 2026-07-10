import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  rpc,
  scValToNative,
  TransactionBuilder,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk';

import { NETWORK_PASSPHRASE, RPC_URL, SIMULATION_SOURCE } from '../config';
import { AppError, classifyError } from './errors';

export const server = new rpc.Server(RPC_URL);

export type TxStage =
  | 'idle'
  | 'simulating'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'failed';

export interface TxProgress {
  stage: TxStage;
  hash?: string;
  error?: AppError;
}

/** Sign an XDR and hand back the signed XDR. Supplied by the wallet layer. */
export type Signer = (xdr: string) => Promise<string>;

export const addressArg = (address: string) => new Address(address).toScVal();

/**
 * Run a contract call through simulation only. Nothing is signed or submitted,
 * so this works for any address, connected or not.
 */
export async function simulate(contractId: string, method: string, ...args: xdr.ScVal[]): Promise<unknown> {
  const source = new Account(SIMULATION_SOURCE, '0');
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw classifyError(new Error(sim.error));
  if (!sim.result) throw new AppError('UNKNOWN', `\`${method}\` returned nothing.`);

  return scValToNative(sim.result.retval);
}

/**
 * Simulate, sign, submit and then watch a contract call all the way to a final
 * ledger result, reporting each stage as it happens.
 *
 * Contract errors — an ended campaign, a short balance — surface during
 * simulation, before the user is ever asked to sign.
 */
export async function invoke(
  source: string,
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sign: Signer,
  onStage: (progress: TxProgress) => void,
): Promise<{ hash: string; returnValue: unknown }> {
  onStage({ stage: 'simulating' });

  const account = await server.getAccount(source);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(contractId).call(method, ...args))
    .setTimeout(120)
    .build();

  // Simulates, then attaches the Soroban auth entries and resource footprint.
  const prepared = await server.prepareTransaction(tx);

  onStage({ stage: 'signing' });
  const signedXdr = await sign(prepared.toXDR());
  const signed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE) as Transaction;

  onStage({ stage: 'submitting' });
  const sent = await server.sendTransaction(signed);
  if (sent.status === 'ERROR') {
    throw classifyError(new Error(JSON.stringify(sent.errorResult ?? sent)));
  }

  onStage({ stage: 'confirming', hash: sent.hash });
  const result = await waitForTransaction(sent.hash);

  onStage({ stage: 'success', hash: sent.hash });
  return {
    hash: sent.hash,
    returnValue: result.returnValue ? scValToNative(result.returnValue) : undefined,
  };
}

/** Poll until the ledger has a verdict on this transaction. */
async function waitForTransaction(
  hash: string,
  timeoutMs = 60_000,
): Promise<rpc.Api.GetSuccessfulTransactionResponse> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await server.getTransaction(hash);

    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return result;
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw classifyError(new Error(resultMessage(result)));
    }
    await sleep(1_000);
  }

  throw new AppError(
    'NETWORK',
    'The transaction did not confirm in time.',
    `It may still land. Check ${hash} on the explorer.`,
  );
}

/**
 * Contract errors normally surface during simulation, so a transaction that
 * fails *after* submission failed for a ledger-level reason (bad sequence, fee
 * too low). Report that code rather than a bare status.
 */
function resultMessage(result: rpc.Api.GetFailedTransactionResponse): string {
  try {
    return `Transaction rejected by the network: ${result.resultXdr.result().switch().name}`;
  } catch {
    return 'Transaction failed on-chain.';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
