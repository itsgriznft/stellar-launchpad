import { formatXlm, isClosed, percentFunded, shortAddress, timeLeft } from '../config';
import type { Listing } from '../lib/factory';

export function CampaignCard({ campaign, onOpen }: { campaign: Listing; onOpen: () => void }) {
  const percent = percentFunded(campaign.raised, campaign.goal);
  const reached = campaign.raised >= campaign.goal;
  const closed = isClosed(campaign.deadline);

  return (
    <article className="card campaign-card">
      <header>
        <h3>{campaign.title}</h3>
        <span className={`pill ${closed ? 'pill--closed' : reached ? 'pill--reached' : 'pill--live'}`}>
          {closed ? 'Closed' : reached ? 'Funded' : 'Live'}
        </span>
      </header>

      <p className="campaign-card__creator muted">by {shortAddress(campaign.creator)}</p>

      <div
        className="progress"
        role="progressbar"
        aria-valuenow={Math.min(percent, 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress__fill" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>

      <dl className="campaign-card__numbers">
        <div>
          <dt>Raised</dt>
          <dd>
            {formatXlm(campaign.raised)} / {formatXlm(campaign.goal)} XLM
          </dd>
        </div>
        <div>
          <dt>Backers</dt>
          <dd>{campaign.contributors}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{timeLeft(campaign.deadline)}</dd>
        </div>
      </dl>

      <button className="button button--primary" onClick={onOpen}>
        {closed ? 'View campaign' : 'Contribute'}
      </button>
    </article>
  );
}
