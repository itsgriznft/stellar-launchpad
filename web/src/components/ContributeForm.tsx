import { useRef, useState } from 'react';

import { formatXlm, isClosed, parseXlm, RESERVE_BUFFER_STROOPS } from '../config';
import type { CampaignState } from '../lib/campaign';
import { contribute } from '../lib/campaign';
import { AppError, classifyError } from '../lib/errors';
import type { TxProgress, TxStage } from '../lib/rpc';
import { signTransaction } from '../lib/wallet';
import type { Wallet } from '../hooks/useWallet';

const PRESETS = ['10', '25', '100'];

interface Props {
  address: string;
  state: CampaignState;
  wallet: Wallet;
  progress: TxProgress;
  onProgress: (progress: TxProgress) => void;
  onConfirmed: () => void;
}

export function ContributeForm({ address, state, wallet, progress, onProgress, onConfirmed }: Props) {
  const [amount, setAmount] = useState('25');

  // Remember how far the transaction got, so a failure can say where it stopped
  // instead of greying out stages that actually succeeded.
  const reached = useRef<TxStage>('idle');

  function report(next: TxProgress) {
    reached.current = next.stage;
    onProgress(next);
  }

  function fail(error: AppError) {
    onProgress({ stage: 'failed', failedAt: reached.current, error });
  }

  const busy = ['simulating', 'signing', 'submitting', 'confirming'].includes(progress.stage);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!wallet.address) return;

    reached.current = 'idle';
    onProgress({ stage: 'idle' });

    let stroops: bigint;
    try {
      stroops = parseXlm(amount);
    } catch (caught) {
      fail(classifyError(caught));
      return;
    }

    if (stroops <= 0n) {
      fail(new AppError('CONTRACT_REJECTED', 'Contribution amount must be greater than zero.'));
      return;
    }

    // Catch the common case before asking the user to sign something the token
    // contract would reject anyway. The buffer covers the account's minimum
    // reserve plus fees.
    const spendable = wallet.balance === null ? null : wallet.balance - RESERVE_BUFFER_STROOPS;
    if (spendable !== null && stroops > spendable) {
      fail(
        new AppError(
          'INSUFFICIENT_BALANCE',
          `You can contribute at most ${formatXlm(spendable > 0n ? spendable : 0n)} XLM.`,
          'Every account must keep a minimum balance on-chain. Fund this account with friendbot to raise the ceiling.',
        ),
      );
      return;
    }

    try {
      await contribute(address, wallet.address, stroops, (xdr) => signTransaction(xdr, wallet.address!), report);
      await wallet.refresh();
      onConfirmed();
    } catch (caught) {
      fail(classifyError(caught));
    }
  }

  if (isClosed(state.deadline)) {
    return (
      <section className="card">
        <h3>Contributions closed</h3>
        <p className="muted">
          {state.raised >= state.goal
            ? 'This campaign reached its goal. The recipient can withdraw the escrowed funds.'
            : 'This campaign missed its goal. Contributors can claim a refund from the contract.'}
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <h3>Contribute</h3>

      <form onSubmit={submit} className="contribute">
        <div className="field__row field__row--large">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={!wallet.address || busy}
            aria-label="Amount in XLM"
          />
          <span className="field__suffix">XLM</span>
        </div>

        <div className="chips">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="chip"
              onClick={() => setAmount(preset)}
              disabled={!wallet.address || busy}
            >
              {preset}
            </button>
          ))}
        </div>

        <button type="submit" className="button button--primary" disabled={!wallet.address || busy}>
          {busy ? 'Working…' : wallet.address ? 'Contribute' : 'Connect a wallet first'}
        </button>
      </form>
    </section>
  );
}
