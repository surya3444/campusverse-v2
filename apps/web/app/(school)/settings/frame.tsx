'use client';

import { PageHeader, cx } from '@campusverse/ui';
import { Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { en } from '../../../messages/en';
import { useMe } from '../common/me';

const TABS = [
  { href: '/settings/profile', key: 'profile', needs: null },
  { href: '/settings', key: 'general', needs: null },
  { href: '/settings/organisation', key: 'organisation', needs: 'platform.organisation.manage' },
  { href: '/settings/fields', key: 'fields', needs: 'platform.fields.manage' },
  { href: '/settings/roles', key: 'roles', needs: 'platform.role.read' },
  { href: '/settings/access', key: 'access', needs: 'platform.role.read' },
  { href: '/settings/approvals', key: 'approvals', needs: 'platform.workflow.manage' },
] as const;

/** Settings' header and section tabs; tabs show only to people who may use them. */
export function SettingsFrame({
  title,
  lead,
  actions,
  children,
}: {
  title: string;
  lead: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const path = usePathname();
  const { can } = useMe();
  const tabs = TABS.filter((tab) => tab.needs === null || can(tab.needs));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Settings}
        art="settings"
        eyebrow={en.nav.groups.school}
        title={title}
        description={lead}
        actions={actions}
      />
      {tabs.length > 1 && (
        <nav aria-label={en.settingsNav.label} className="-mt-1 overflow-x-auto">
          <ul className="flex min-w-max gap-1 border-b border-line">
            {tabs.map((tab) => {
              const current = path === tab.href;
              return (
                <li key={tab.href}>
                  <Link
                    href={tab.href}
                    aria-current={current ? 'page' : undefined}
                    className={cx(
                      '-mb-px inline-flex h-11 items-center border-b-2 px-4 text-body transition-colors',
                      current
                        ? 'border-navy-950 font-semibold text-navy-950'
                        : 'border-transparent text-ink-muted hover:text-ink',
                    )}
                  >
                    {en.settingsNav[tab.key]}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      {children}
    </div>
  );
}
