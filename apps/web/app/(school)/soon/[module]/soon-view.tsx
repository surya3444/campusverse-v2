'use client';

import { EmptyState, PageHeader, Pill } from '@campusverse/ui';
import Link from 'next/link';
import { SYSTEMS } from '../../../../lib/systems';
import { en } from '../../../../messages/en';

/** A rule-book module that isn't built yet: its name, what it will do, and where it sits. */
export function SoonView({ module }: { module: string }) {
  const system = SYSTEMS.find((s) => s.apps.some((a) => a.key === module));
  const app = system?.apps.find((a) => a.key === module);
  if (!system || !app) return null;
  const [name = module, purpose] =
    (en.systems.apps as Record<string, readonly string[]>)[module] ?? [];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={system.Icon}
        eyebrow={en.systems.groups[system.key]}
        title={name}
        description={purpose}
      >
        <Pill tone="neutral">{en.systems.planned}</Pill>
      </PageHeader>
      <section className="panel">
        <EmptyState
          icon={app.Icon}
          area={system.area}
          title={en.soon.title}
          body={en.soon.body}
          actions={
            <Link href="/apps" className="font-medium text-navy-950 underline underline-offset-4">
              {en.soon.allApps}
            </Link>
          }
        />
      </section>
    </div>
  );
}
