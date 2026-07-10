import { formatXlm, shortAddress, txUrl } from '../config';
import type { ContributionEvent } from '../lib/campaign';
import { Skeleton } from './Skeleton';

export function ActivityFeed({
  events,
  you,
  loading,
}: {
  events: ContributionEvent[];
  you: string | null;
  loading: boolean;
}) {
  return (
    <section className="card feed">
      <header className="feed__header">
        <h3>Live activity</h3>
        <span className="muted">contract events · last 24h</span>
      </header>

      {loading && events.length === 0 ? (
        <ul className="feed__list" aria-busy="true">
          {[0, 1, 2].map((index) => (
            <li key={index}>
              <div className="feed__who">
                <Skeleton width={110} height={13} />
                <Skeleton width={140} height={11} />
              </div>
            </li>
          ))}
        </ul>
      ) : events.length === 0 ? (
        <p className="muted">No contributions in the last 24 hours.</p>
      ) : (
        <ul className="feed__list">
          {events.map((event) => (
            <li key={event.id} className={event.contributor === you ? 'is-you' : ''}>
              <div className="feed__who">
                <strong>{event.contributor === you ? 'You' : shortAddress(event.contributor)}</strong>
                <small>{event.at.toLocaleString()}</small>
              </div>
              <div className="feed__what">
                <strong>+{formatXlm(event.amount)} XLM</strong>
                <small>total {formatXlm(event.raised)}</small>
              </div>
              <a href={txUrl(event.txHash)} target="_blank" rel="noreferrer" className="feed__link">
                tx ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
