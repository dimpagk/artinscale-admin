import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader, StatCard, EmptyState } from '@/components/admin-ui';

async function getDashboardStats() {
  const [
    { count: pendingCount },
    { count: activeTopicsCount },
    { data: allContributions },
    { data: recentPending },
  ] = await Promise.all([
    supabaseAdmin
      .from('topic_contributions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
    supabaseAdmin
      .from('topics')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabaseAdmin
      .from('topic_contributions')
      .select('contributor_email'),
    supabaseAdmin
      .from('topic_contributions')
      .select('id, contributor_name, topic_id, type, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const uniqueContributors = new Set(
    (allContributions || []).map((c) => c.contributor_email)
  ).size;

  return {
    pendingContributions: pendingCount || 0,
    activeTopics: activeTopicsCount || 0,
    totalContributors: uniqueContributors,
    recentPending: recentPending || [],
  };
}

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div>
      <PageHeader title="Dashboard" />

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Pending Contributions"
          value={stats.pendingContributions}
          valueColorClass={
            stats.pendingContributions > 0 ? 'text-brand-gold' : 'text-gray-900'
          }
          href="/contributions?status=pending"
        />
        <StatCard
          label="Active Topics"
          value={stats.activeTopics}
          href="/topics"
        />
        <StatCard
          label="Total Contributors"
          value={stats.totalContributors}
          href="/contributions"
        />
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Recent Pending Contributions
        </h2>
        {stats.recentPending.length === 0 ? (
          <EmptyState
            title="Nothing pending"
            description="When community contributions arrive, they show up here."
          />
        ) : (
          <div className="-mx-6 divide-y divide-gray-100">
            {stats.recentPending.map((item) => (
              <Link
                key={item.id}
                href={`/contributions/${item.id}`}
                className="flex items-center justify-between px-6 py-3 transition-colors hover:bg-gray-50"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {item.contributor_name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {item.topic_id} &middot;{' '}
                    {new Date(item.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant="outline" size="sm">
                  {item.type}
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
