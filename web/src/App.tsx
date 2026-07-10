import { useEffect, useState } from 'react';

import './App.css';
import { CampaignCard } from './components/CampaignCard';
import { CampaignDetail } from './components/CampaignDetail';
import { CreateCampaignForm } from './components/CreateCampaignForm';
import { ErrorBanner } from './components/ErrorBanner';
import { CampaignCardSkeleton, StatsBarSkeleton } from './components/Skeleton';
import { StatsBar } from './components/StatsBar';
import { TxStatus } from './components/TxStatus';
import { WalletBar } from './components/WalletBar';
import { contractUrl, FACTORY_ID, shortAddress } from './config';
import { useLaunchpad } from './hooks/useLaunchpad';
import { useWallet } from './hooks/useWallet';
import type { TxProgress } from './lib/rpc';

/**
 * The selected campaign lives in the URL hash, so a campaign is linkable and
 * the browser's back button works without pulling in a router.
 */
function useHashRoute(): [string | null, (address: string | null) => void] {
  const [hash, setHash] = useState(() => window.location.hash.slice(1));

  useEffect(() => {
    const onChange = () => setHash(window.location.hash.slice(1));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return [
    hash || null,
    (address) => {
      window.location.hash = address ?? '';
    },
  ];
}

export default function App() {
  const wallet = useWallet();
  const launchpad = useLaunchpad();
  const [selected, select] = useHashRoute();
  const [creating, setCreating] = useState(false);
  const [progress, setProgress] = useState<TxProgress>({ stage: 'idle' });

  // A failed create reports through the tx panel; anything the wallet or the
  // poller hits is a page-level problem. A poll failure only surfaces once
  // there is no listing left to show.
  const banner = progress.error ?? wallet.error ?? (launchpad.stats ? null : launchpad.error);

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>Stellar Launchpad</h1>
          <p className="muted">
            Factory{' '}
            <a href={contractUrl(FACTORY_ID)} target="_blank" rel="noreferrer">
              {shortAddress(FACTORY_ID)}
            </a>{' '}
            · Soroban testnet · Orange Belt
          </p>
        </div>
        <WalletBar wallet={wallet} />
      </header>

      {banner && (
        <ErrorBanner
          error={banner}
          onDismiss={progress.error ? () => setProgress({ stage: 'idle' }) : undefined}
        />
      )}

      {selected ? (
        <CampaignDetail address={selected} wallet={wallet} onBack={() => select(null)} />
      ) : (
        <main className="page__body">
          {launchpad.stats ? (
            <StatsBar stats={launchpad.stats} syncedAt={launchpad.syncedAt} />
          ) : (
            <StatsBarSkeleton />
          )}

          {creating ? (
            <>
              <CreateCampaignForm
                wallet={wallet}
                progress={progress}
                onProgress={setProgress}
                onCreated={(address) => {
                  setCreating(false);
                  launchpad.refresh();
                  select(address);
                }}
                onCancel={() => {
                  setCreating(false);
                  setProgress({ stage: 'idle' });
                }}
              />
              <TxStatus progress={progress} />
            </>
          ) : (
            <div className="section-header">
              <h2>Campaigns</h2>
              <button className="button button--primary" onClick={() => setCreating(true)}>
                Start a campaign
              </button>
            </div>
          )}

          {launchpad.loading && launchpad.listing.length === 0 ? (
            <div className="grid">
              <CampaignCardSkeleton />
              <CampaignCardSkeleton />
              <CampaignCardSkeleton />
            </div>
          ) : launchpad.listing.length === 0 ? (
            <section className="card">
              <p className="muted">No campaigns yet. Be the first to start one.</p>
            </section>
          ) : (
            <div className="grid">
              {launchpad.listing.map((campaign) => (
                <CampaignCard
                  key={campaign.address}
                  campaign={campaign}
                  onOpen={() => select(campaign.address)}
                />
              ))}
            </div>
          )}
        </main>
      )}

      <footer className="page__footer muted">
        Testnet only. Get free XLM from{' '}
        <a href="https://lab.stellar.org/account/fund" target="_blank" rel="noreferrer">
          friendbot
        </a>
        .
      </footer>
    </div>
  );
}
