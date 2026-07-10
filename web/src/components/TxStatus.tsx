import { txUrl } from '../config';
import type { TxProgress, TxStage } from '../lib/rpc';

/** The stages a contribution passes through, in order, with what each one means. */
const STAGES: { stage: TxStage; label: string; detail: string }[] = [
  { stage: 'simulating', label: 'Simulating', detail: 'Checking the call against the current ledger' },
  { stage: 'signing', label: 'Signing', detail: 'Waiting for your wallet' },
  { stage: 'submitting', label: 'Submitting', detail: 'Sending the transaction to the network' },
  { stage: 'confirming', label: 'Confirming', detail: 'Waiting for the ledger to close' },
];

const ORDER: TxStage[] = ['idle', 'simulating', 'signing', 'submitting', 'confirming', 'success'];

export function TxStatus({ progress }: { progress: TxProgress }) {
  if (progress.stage === 'idle') return null;

  const failed = progress.stage === 'failed';
  const succeeded = progress.stage === 'success';
  const currentIndex = ORDER.indexOf(progress.stage);

  return (
    <section className={`card tx tx--${progress.stage}`} aria-live="polite">
      <h3>
        {succeeded ? 'Contribution confirmed' : failed ? 'Contribution failed' : 'Contribution in progress'}
      </h3>

      <ol className="tx__stages">
        {STAGES.map(({ stage, label, detail }) => {
          const index = ORDER.indexOf(stage);
          const done = succeeded || (currentIndex > index && !failed);
          const active = progress.stage === stage;

          return (
            <li key={stage} className={done ? 'is-done' : active ? 'is-active' : failed ? 'is-stopped' : ''}>
              <span className="tx__dot" aria-hidden="true">
                {done ? '✓' : active ? '•' : ''}
              </span>
              <div>
                <strong>{label}</strong>
                <small>{detail}</small>
              </div>
            </li>
          );
        })}
      </ol>

      {progress.hash && (
        <p className="tx__hash">
          <a href={txUrl(progress.hash)} target="_blank" rel="noreferrer">
            View transaction on Stellar Expert ↗
          </a>
          <code>{progress.hash}</code>
        </p>
      )}
    </section>
  );
}
