import { formatXlm } from '../config';
import type { Stats } from '../lib/factory';

export function StatsBar({ stats, syncedAt }: { stats: Stats; syncedAt: Date | null }) {
  const partial = stats.aggregated < stats.campaigns;

  return (
    <section className="card stats">
      <div className="stats__item">
        <strong>{stats.campaigns}</strong>
        <span>{stats.campaigns === 1 ? 'campaign' : 'campaigns'}</span>
      </div>
      <div className="stats__item">
        <strong>{formatXlm(stats.totalRaised)}</strong>
        <span>XLM raised{partial && ' (first ' + stats.aggregated + ')'}</span>
      </div>
      <div className="stats__item">
        <strong>{formatXlm(stats.totalGoal)}</strong>
        <span>XLM targeted</span>
      </div>
      <div className="stats__item">
        <strong>{stats.funded}</strong>
        <span>fully funded</span>
      </div>
      <span className="stats__sync">
        {syncedAt ? `● synced ${syncedAt.toLocaleTimeString()}` : '○ syncing…'}
      </span>
    </section>
  );
}
