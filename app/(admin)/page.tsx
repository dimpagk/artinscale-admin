import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

  const statCards = [
    {
      label: 'Pending Contributions',
      value: stats.pendingContributions,
      href: '/contributions?status=pending',
      color: stats.pendingContributions > 0 ? 'text-yellow-600' : 'text-gray-900',
    },
    {
      label: 'Active Topics',
      value: stats.activeTopics,
      href: '/topics',
      color: 'text-gray-900',
    },
    {
      label: 'Total Contributors',
      value: stats.totalContributors,
      href: '/contributions',
      color: 'text-gray-900',
    },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {statCards.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="hover:border-gray-300 transition-colors">
              <p className="text-sm text-gray-500">{stat.label}</p>
              <p className={`mt-1 text-3xl font-bold ${stat.color}`}>{stat.value}</p>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Recent Pending Contributions</h2>
        {stats.recentPending.length === 0 ? (
          <p className="text-sm text-gray-500">No pending contributions</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {stats.recentPending.map((item) => (
              <Link
                key={item.id}
                href={`/contributions/${item.id}`}
                className="flex items-center justify-between py-3 hover:bg-gray-50 -mx-6 px-6 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-gray-900">{item.contributor_name}</p>
                  <p className="text-xs text-gray-500">
                    {item.topic_id} &middot; {new Date(item.created_at).toLocaleDateString()}
                  </p>
                </div>
                <Badge variant="outline" size="sm">{item.type}</Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
