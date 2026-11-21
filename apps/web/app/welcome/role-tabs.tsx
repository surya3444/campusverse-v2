'use client';

import { Illustration, Segmented, type IllustrationName } from '@campusverse/ui';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { en } from '../../messages/en';

const t = en.landing.roles;
const ROLES = ['owner', 'office', 'teacher', 'parent', 'driver'] as const;
type Role = (typeof ROLES)[number];
const ART: Record<Role, IllustrationName> = {
  owner: 'welcome',
  office: 'fees',
  teacher: 'attendance',
  parent: 'students',
  driver: 'transport',
};

/** What each role's day looks like, one role at a time. */
export function RoleTabs() {
  const [role, setRole] = useState<Role>('owner');
  return (
    <div className="mt-10 flex flex-col gap-6">
      <div className="max-w-full overflow-x-auto pb-1">
        <Segmented
          label={t.title}
          value={role}
          onChange={setRole}
          options={ROLES.map((r) => ({ value: r, label: t.tabs[r] ?? r }))}
        />
      </div>
      <div
        role="region"
        aria-live="polite"
        aria-label={t.tabs[role]}
        className="grid items-center gap-8 rounded-[1.75rem] border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]"
      >
        <div>
          <h3 className="font-display text-[1.6rem] font-semibold tracking-[-0.02em] text-ink">
            {t.tabs[role]}
          </h3>
          <ul className="mt-6 flex flex-col gap-4">
            {(t.points[role] ?? []).map((p) => (
              <li key={p} className="flex items-start gap-3 text-lead text-ink">
                <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-signal-go-tint">
                  <Check aria-hidden className="size-3.5 text-signal-go-ink" />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto w-full max-w-sm rounded-2xl bg-paper p-6">
          <Illustration name={ART[role]} className="h-auto w-full" />
        </div>
      </div>
    </div>
  );
}
