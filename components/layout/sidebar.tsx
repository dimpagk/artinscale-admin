'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  House,
  Tray,
  ListBullets,
  ChatCircle,
  PaintBrushHousehold,
  Image,
  Receipt,
  ChartLineUp,
  Globe,
  PencilSimpleLine,
  MagicWand,
  Palette,
  Armchair,
  SignOut,
} from '@phosphor-icons/react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

interface NavSection {
  /** Section heading; omitted for the top (unlabeled) group. */
  label?: string;
  items: NavItem[];
}

// Grouped so the eye scans ~5 sections instead of a flat wall of links.
// Pricing lives under Economics now; the old "Ad Copy" page folded into
// Content. Both still resolve via redirects.
const sections: NavSection[] = [
  {
    items: [
      { href: '/', label: 'Dashboard', icon: <House size={16} weight="duotone" /> },
      { href: '/queue', label: 'Inbox', icon: <Tray size={16} weight="duotone" /> },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { href: '/topics', label: 'Topics', icon: <ListBullets size={16} weight="duotone" /> },
      { href: '/contributions', label: 'Contributions', icon: <ChatCircle size={16} weight="duotone" /> },
      // Each artist owns one style pack — edited from the artist's page.
      { href: '/artists', label: 'Artists', icon: <PaintBrushHousehold size={16} weight="duotone" /> },
      { href: '/artworks', label: 'Artworks', icon: <Image size={16} weight="duotone" /> },
      { href: '/art-generator', label: 'AI Art', icon: <MagicWand size={16} weight="duotone" /> },
      { href: '/external-prints', label: 'External Prints', icon: <Globe size={16} weight="duotone" /> },
    ],
  },
  {
    label: 'Commerce',
    items: [
      { href: '/orders', label: 'Orders', icon: <Receipt size={16} weight="duotone" /> },
      { href: '/economics', label: 'Economics', icon: <ChartLineUp size={16} weight="duotone" /> },
    ],
  },
  {
    label: 'Marketing',
    items: [
      { href: '/content', label: 'Content', icon: <PencilSimpleLine size={16} weight="duotone" /> },
    ],
  },
  {
    label: 'Utility',
    items: [
      { href: '/scenes', label: 'Room Scenes', icon: <Armchair size={16} weight="duotone" /> },
      { href: '/components-demo', label: 'Components', icon: <Palette size={16} weight="duotone" /> },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col self-start bg-[var(--brand-navy)] text-white">
      <div className="border-b border-white/10 px-5 py-4">
        <h1 className="font-display text-base font-bold tracking-tight">Artinscale</h1>
        <p className="text-[11px] text-white/50">Admin Panel</p>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section, i) => (
          <div key={section.label ?? `top-${i}`} className={cn(i > 0 && 'mt-5')}>
            {section.label && (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/10 px-3 py-4">
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
        >
          <span className="grid h-5 w-5 place-items-center text-current">
            <SignOut size={16} weight="duotone" />
          </span>
          Sign Out
        </button>
      </div>
    </aside>
  );
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive =
    item.href === '/'
      ? pathname === '/'
      : pathname === item.href || pathname.startsWith(item.href + '/');
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-white/10 text-white'
          : 'text-white/60 hover:bg-white/5 hover:text-white'
      )}
    >
      <span className="grid h-5 w-5 place-items-center text-current">{item.icon}</span>
      {item.label}
    </Link>
  );
}
