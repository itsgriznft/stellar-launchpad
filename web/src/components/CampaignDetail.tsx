import { useState } from 'react';

import { contractUrl, formatXlm, isClosed, percentFunded, shortAddress, timeLeft } from '../config';
import { useCampaign } from '../hooks/useCampaign';
import type { Wallet } from '../hooks/useWallet';
import type { CampaignState } from '../lib/campaign';
import type { TxProgress } from '../lib/rpc';
import { ActivityFeed } from './ActivityFeed';
import { ContributeForm } from './ContributeForm';
import { ErrorBanner } from './ErrorBanner';
import { Skeleton } from './Skeleton';
import { TxStatus } from './TxStatus';

export function CampaignDetail({
  address,
  wallet,
  onBack,
}: {
  address: string;
  wallet: Wallet;
  onBack: () => void;
}) {
  const campaign = useCampaign(address);
  const [progress, setProgress] = useState<TxProgress>({ stage: 'idle' });

  const banner = progress.error ?? (campaign.state ? null : campaign.error);

  return (
    <section className="detail">
      <button className="button button--ghost" onClick={onBack}>
        ← All campaigns
      </button>

      {banner && (
        <ErrorBanner
          error={banner}
          onDismiss={progress.error ? () => setProgress({ stage: 'idle' }) : undefined}
        />
      )}

      {!campaign.state ? (
        <section className="card" aria-busy="true">
          <Skeleton width="50%" height={22} />
          <div className="progress">
            <div className="progress__fill" style={{ width: '0%' }} />
          </div>
          <Skeleton width="70%" height={12} />
        </section>
      ) : (
        <>
          <Header state={campaign.state} address={address} syncedAt={campaign.syncedAt} />

          <div className="detail__columns">
            <div className="detail__column">
              <ContributeForm
                address={address}
                state={campaign.state}
                wallet={wallet}
                progress={progress}
                onProgress={setProgress}
                onConfirmed={campaign.refresh}
              />
              <TxStatus progress={progress} />
            </div>
            <ActivityFeed events={campaign.events} you={wallet.address} loading={campaign.loading} />
          </div>
        </>
      )}
    </section>
  );
}

function Header({
  state,
  address,
  syncedAt,
}: {
  state: CampaignState;
  address: string;
  syncedAt: Date | null;
}) {
  const percent = percentFunded(state.raised, state.goal);
  const reached = state.raised >= state.goal;
  const closed = isClosed(state.deadline);

  return (
    <section className="card campaign">
      <header className="campaign__header">
        <h2>{state.title}</h2>
        <span className={`pill ${closed ? 'pill--closed' : reached ? 'pill--reached' : 'pill--live'}`}>
          {closed ? 'Closed' : reached ? 'Goal reached' : 'Live'}
        </span>
      </header>

      <div
        className="progress"
        role="progressbar"
        aria-valuenow={Math.min(percent, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress__fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>

      <div className="campaign__numbers">
        <div>
          <strong>{formatXlm(state.raised)}</strong>
          <span>raised of {formatXlm(state.goal)} XLM</span>
        </div>
        <div>
          <strong>{percent.toFixed(1)}%</strong>
          <span>funded</span>
        </div>
        <div>
          <strong>{state.contributors}</strong>
          <span>{state.contributors === 1 ? 'backer' : 'backers'}</span>
        </div>
        <div>
          <strong>{timeLeft(state.deadline)}</strong>
          <span>deadline {new Date(Number(state.deadline) * 1000).toLocaleDateString()}</span>
        </div>
      </div>

      <footer className="campaign__meta">
        <span>
          Contract{' '}
          <a href={contractUrl(address)} target="_blank" rel="noreferrer">
            {shortAddress(address)}
          </a>
        </span>
        <span>Recipient {shortAddress(state.recipient)}</span>
        <span className="campaign__sync">
          {syncedAt ? `● synced ${syncedAt.toLocaleTimeString()}` : '○ syncing…'}
        </span>
      </footer>
    </section>
  );
}
