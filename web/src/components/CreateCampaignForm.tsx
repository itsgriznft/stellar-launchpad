import { useState } from 'react';

import { MAX_TITLE_LEN, parseXlm } from '../config';
import { AppError, classifyError } from '../lib/errors';
import { createCampaign } from '../lib/factory';
import type { TxProgress } from '../lib/rpc';
import { signTransaction } from '../lib/wallet';
import type { Wallet } from '../hooks/useWallet';

const DURATIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
];

interface Props {
  wallet: Wallet;
  progress: TxProgress;
  onProgress: (progress: TxProgress) => void;
  onCreated: (address: string) => void;
  onCancel: () => void;
}

export function CreateCampaignForm({ wallet, progress, onProgress, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [goal, setGoal] = useState('1000');
  const [days, setDays] = useState(30);

  const busy = ['simulating', 'signing', 'submitting', 'confirming'].includes(progress.stage);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!wallet.address) return;

    onProgress({ stage: 'idle' });

    const trimmed = title.trim();
    if (trimmed.length === 0) {
      onProgress({
        stage: 'failed',
        error: new AppError('CONTRACT_REJECTED', 'Give the campaign a title.'),
      });
      return;
    }

    let goalStroops: bigint;
    try {
      goalStroops = parseXlm(goal);
    } catch (caught) {
      onProgress({ stage: 'failed', error: classifyError(caught) });
      return;
    }
    if (goalStroops <= 0n) {
      onProgress({
        stage: 'failed',
        error: new AppError('CONTRACT_REJECTED', 'The goal must be greater than zero.'),
      });
      return;
    }

    const deadline = BigInt(Math.floor(Date.now() / 1000) + days * 86_400);

    try {
      const { address } = await createCampaign(
        wallet.address,
        trimmed,
        goalStroops,
        deadline,
        (xdr) => signTransaction(xdr, wallet.address!),
        onProgress,
      );
      await wallet.refresh();
      onCreated(address);
    } catch (caught) {
      onProgress({ stage: 'failed', error: classifyError(caught) });
    }
  }

  return (
    <section className="card">
      <header className="section-header">
        <h3>Start a campaign</h3>
        <button className="button button--ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </header>

      <p className="muted">
        The factory deploys a brand-new campaign contract for you, and you become its recipient.
      </p>

      <form onSubmit={submit} className="form">
        <label className="field">
          <span>Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value.slice(0, MAX_TITLE_LEN))}
            placeholder="Fund the Soroban docs"
            disabled={!wallet.address || busy}
          />
          <small className="muted">
            {title.length}/{MAX_TITLE_LEN}
          </small>
        </label>

        <label className="field">
          <span>Goal</span>
          <div className="field__row">
            <input
              inputMode="decimal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              disabled={!wallet.address || busy}
            />
            <span className="field__suffix">XLM</span>
          </div>
        </label>

        <fieldset className="field" disabled={!wallet.address || busy}>
          <span>Runs for</span>
          <div className="chips">
            {DURATIONS.map((duration) => (
              <button
                key={duration.days}
                type="button"
                className={`chip ${days === duration.days ? 'chip--active' : ''}`}
                onClick={() => setDays(duration.days)}
              >
                {duration.label}
              </button>
            ))}
          </div>
        </fieldset>

        <button type="submit" className="button button--primary" disabled={!wallet.address || busy}>
          {busy ? 'Deploying…' : wallet.address ? 'Deploy campaign' : 'Connect a wallet first'}
        </button>
      </form>
    </section>
  );
}
