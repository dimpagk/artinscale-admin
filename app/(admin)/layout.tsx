import { Sidebar } from '@/components/layout/sidebar';

// Admin pages are auth-gated and operator-only — never publicly cached or
// statically generated. Forcing dynamic skips Next.js's static prerender
// step (which trips on useSearchParams + similar client-only hooks in
// pages like /art-generator that aren't yet wrapped in Suspense).
export const dynamic = 'force-dynamic';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 bg-gray-50 px-6 py-6 lg:px-8">{children}</main>
    </div>
  );
}
