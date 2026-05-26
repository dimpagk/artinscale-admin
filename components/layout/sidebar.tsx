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
  Globe,
  PencilSimpleLine,
  MagicWand,
  Palette,
  SignOut,
} from '@phosphor-icons/react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: <House size={16} weight="duotone" /> },
  { href: '/queue', label: 'Inbox', icon: <Tray size={16} weight="duotone" /> },
  { href: '/topics', label: 'Topics', icon: <ListBullets size={16} weight="duotone" /> },
  { href: '/contributions', label: 'Contributions', icon: <ChatCircle size={16} weight="duotone" /> },
  // Each artist owns one style pack — they're edited together from the
  // artist's page rather than as separate sidebar entries.
  { href: '/artists', label: 'Artists', icon: <PaintBrushHousehold size={16} weight="duotone" /> },
  { href: '/artworks', label: 'Artworks', icon: <Image size={16} weight="duotone" /> },
  { href: '/external-prints', label: 'External Prints', icon: <Globe size={16} weight="duotone" /> },
  { href: '/content', label: 'Content', icon: <PencilSimpleLine size={16} weight="duotone" /> },
  { href: '/art-generator', label: 'AI Art', icon: <MagicWand size={16} weight="duotone" /> },
];

const utilityItems: NavItem[] = [
  { href: '/components-demo', label: 'Components', icon: <Palette size={16} weight="duotone" /> },
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

      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        <div className="my-4 border-t border-white/10" />

        <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40">
          Utility
        </p>
        {utilityItems.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
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
