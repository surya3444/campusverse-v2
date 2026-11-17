'use client';

import type { Staff } from '@campusverse/platform-control';
import { cx } from '@campusverse/ui';
import logoWhite from '@campusverse/ui/brand/logo-white.svg';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  CheckCheck,
  Flag,
  Gavel,
  LifeBuoy,
  LogOut,
  Power,
  ShieldAlert,
  ScrollText,
  Tags,
  UserCog,
  type LucideIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { en } from '../../messages/en';

const NAV: { href: string; label: string; Icon: LucideIcon; owner?: boolean }[] = [
  { href: '/', label: en.nav.customers, Icon: Building2 },
  { href: '/approvals', label: en.nav.approvals, Icon: CheckCheck },
  { href: '/support', label: en.nav.support, Icon: LifeBuoy },
  { href: '/health', label: en.nav.health, Icon: Activity },
  { href: '/switches', label: en.nav.switches, Icon: Power },
  { href: '/flags', label: en.nav.flags, Icon: Flag },
  { href: '/plans', label: en.nav.plans, Icon: Tags },
  { href: '/rule-packs', label: en.nav.rulePacks, Icon: Gavel },
  { href: '/incidents', label: en.nav.incidents, Icon: ShieldAlert },
  { href: '/audit', label: en.nav.audit, Icon: ScrollText },
  { href: '/staff', label: en.nav.staff, Icon: UserCog, owner: true },
];

export function Shell({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <Frame>{children}</Frame>
    </QueryClientProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Staff>('/me') });
  const active = (href: string) =>
    href === '/' ? path === '/' || path.startsWith('/customers') : path.startsWith(href);
  const links = NAV.filter((n) => !n.owner || me.data?.role === 'owner');
  return (
    <div className="lg:flex">
      <aside className="midnight lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col">
        <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5 lg:py-5">
          {/* Sized by attributes too: the SVG is 3430 px wide if styles arrive late. */}
          <Image
            src={logoWhite}
            alt={en.app.name}
            width={101}
            height={32}
            className="h-8 w-auto"
            priority
          />
          <form action="/session/sign-out" method="post" className="lg:hidden">
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-caption text-white/70 hover:bg-white/10 hover:text-white"
            >
              <LogOut aria-hidden className="size-4" />
              {en.nav.signOut}
            </button>
          </form>
        </div>
        <nav aria-label={en.nav.menu} className="lg:flex-1">
          <ul className="flex gap-1 overflow-x-auto px-3 pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
            {links.map(({ href, label, Icon }) => (
              <li key={href} className="shrink-0">
                <Link
                  href={href}
                  aria-current={active(href) ? 'page' : undefined}
                  className={cx(
                    'flex items-center gap-2.5 rounded-xl px-3 py-2 text-body whitespace-nowrap transition-colors',
                    active(href)
                      ? 'bg-white/[0.12] font-medium text-white shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]'
                      : 'text-white/70 hover:bg-white/[0.06] hover:text-white',
                  )}
                >
                  <Icon
                    aria-hidden
                    className={cx('size-4', active(href) ? 'text-cyan-400' : 'text-white/55')}
                  />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="m-3 hidden items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-3 lg:flex">
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body font-medium text-white">{me.data?.name}</span>
            <span className="text-caption text-white/65">{en.roles[me.data?.role ?? '']}</span>
          </span>
          <form action="/session/sign-out" method="post">
            <button
              type="submit"
              aria-label={en.nav.signOut}
              className="flex size-8 items-center justify-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white"
            >
              <LogOut aria-hidden className="size-4" />
            </button>
          </form>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto w-full max-w-[1240px]">{children}</div>
      </main>
    </div>
  );
}
