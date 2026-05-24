import { Card } from '@/components/ui/card';
import type { ContributionStats } from '@/lib/contributions';

interface ContributionMetricsProps {
  stats: ContributionStats;
}

export function ContributionMetrics({ stats }: ContributionMetricsProps) {
  const typeOrder: Array<keyof ContributionStats['byType']> = ['story', 'photo', 'sound', 'link'];
  const typeTotal = typeOrder.reduce((sum, t) => sum + stats.byType[t], 0) || 1;
  const sourceTotal = stats.bySource.community + stats.bySource.studio_seed || 1;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Card padding="md">
        <p className="text-xs uppercase tracking-wide text-gray-500">Total</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{stats.total}</p>
        <p className="mt-1 text-xs text-gray-500">
          {stats.uniqueContributors} contributor{stats.uniqueContributors === 1 ? '' : 's'}
        </p>
      </Card>

      <Card padding="md">
        <p className="text-xs uppercase tracking-wide text-gray-500">Pending</p>
        <p
          className={`mt-1 text-2xl font-semibold ${
            stats.pending > 0 ? 'text-amber-600' : 'text-gray-900'
          }`}
        >
          {stats.pending}
        </p>
        <p className="mt-1 text-xs text-gray-500">awaiting review</p>
      </Card>

      <Card padding="md">
        <p className="text-xs uppercase tracking-wide text-gray-500">Approval rate</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{stats.approvalRate}%</p>
        <p className="mt-1 text-xs text-gray-500">
          {stats.approved} approved · {stats.rejected} rejected
        </p>
      </Card>

      <Card padding="md">
        <p className="text-xs uppercase tracking-wide text-gray-500">Recent activity</p>
        <p className="mt-1 text-2xl font-semibold text-gray-900">{stats.recent7d}</p>
        <p className="mt-1 text-xs text-gray-500">
          last 7 days · {stats.recent30d} in 30
        </p>
      </Card>

      <Card padding="md" className="sm:col-span-2">
        <p className="text-xs uppercase tracking-wide text-gray-500">By type</p>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-100">
          {typeOrder.map((t) => {
            const pct = (stats.byType[t] / typeTotal) * 100;
            const color = TYPE_COLORS[t];
            return pct > 0 ? (
              <div
                key={t}
                className={color}
                style={{ width: `${pct}%` }}
                title={`${t}: ${stats.byType[t]}`}
              />
            ) : null;
          })}
        </div>
        <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
          {typeOrder.map((t) => (
            <div key={t}>
              <dt className="flex items-center gap-1.5 text-gray-500">
                <span className={`h-2 w-2 rounded-full ${TYPE_COLORS[t]}`} />
                {t}
              </dt>
              <dd className="font-medium text-gray-900">{stats.byType[t]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card padding="md" className="sm:col-span-2">
        <p className="text-xs uppercase tracking-wide text-gray-500">By source</p>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-gray-100">
          {stats.bySource.community > 0 && (
            <div
              className="bg-emerald-500"
              style={{ width: `${(stats.bySource.community / sourceTotal) * 100}%` }}
            />
          )}
          {stats.bySource.studio_seed > 0 && (
            <div
              className="bg-violet-500"
              style={{ width: `${(stats.bySource.studio_seed / sourceTotal) * 100}%` }}
            />
          )}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <dt className="flex items-center gap-1.5 text-gray-500">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Community
            </dt>
            <dd className="font-medium text-gray-900">{stats.bySource.community}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1.5 text-gray-500">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              Studio seeds
            </dt>
            <dd className="font-medium text-gray-900">{stats.bySource.studio_seed}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}

const TYPE_COLORS: Record<keyof ContributionStats['byType'], string> = {
  story: 'bg-blue-500',
  photo: 'bg-amber-500',
  sound: 'bg-pink-500',
  link: 'bg-teal-500',
};
