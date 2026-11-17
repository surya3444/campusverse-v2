'use client';

import { IconTile, PageHeader, Pill, cx, type Tone } from '@campusverse/ui';
import { ArrowUpRight, LayoutGrid } from 'lucide-react';
import Link from 'next/link';
import { SYSTEMS, type AppEntry, type AppStatus } from '../../../lib/systems';
import { en } from '../../../messages/en';
import { useSchoolActions } from '../shell';

const t = en.systems;
const TONE: Record<AppStatus, Tone> = { live: 'go', building: 'warn', planned: 'neutral' };

/** Every module of the nine systems, Campus Core and Verse AI, with what is live, being built and planned. */
export function AppsView() {
  const all = SYSTEMS.flatMap((s) => s.apps);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={LayoutGrid}
        art="welcome"
        area="navy"
        eyebrow={en.app.name}
        title={t.title}
        description={t.lead}
      >
        <Pill tone="go">
          {t.appsCount(all.filter((a) => a.status === 'live').length, all.length)}
        </Pill>
      </PageHeader>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        {SYSTEMS.map((s) => (
          <section key={s.key} aria-labelledby={`system-${s.key}`} className="panel flex flex-col">
            <header className="flex items-center gap-3 border-b border-line px-5 py-4">
              <IconTile icon={s.Icon} area={s.area} />
              <div className="min-w-0 flex-1">
                <h2
                  id={`system-${s.key}`}
                  className="font-display text-lead font-semibold text-ink"
                >
                  {t.groups[s.key]}
                </h2>
                <p className="text-caption text-ink-muted">{t.taglines[s.key]}</p>
              </div>
              <span className="tabular text-caption text-ink-muted">
                {t.appsCount(s.apps.filter((a) => a.status === 'live').length, s.apps.length)}
              </span>
            </header>
            <ul className="grid flex-1 gap-px overflow-hidden rounded-b-2xl bg-line sm:grid-cols-2 sm:[&>li:last-child:nth-child(odd)]:col-span-2">
              {s.apps.map((a) => (
                <li key={a.key} className="bg-surface">
                  <AppCard app={a} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function AppCard({ app }: { app: AppEntry }) {
  const { openPalette } = useSchoolActions();
  const [name, about] = t.apps[app.key] ?? [app.key, ''];
  const body = (
    <>
      <span className="flex items-start gap-3">
        <app.Icon
          aria-hidden
          className={cx(
            'mt-0.5 size-5 shrink-0',
            app.status === 'planned' ? 'text-ink-muted' : 'text-navy-950',
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span
              className={cx(
                'text-body font-semibold',
                app.status === 'planned' ? 'text-ink-muted' : 'text-ink',
              )}
            >
              {name}
            </span>
            <Pill tone={TONE[app.status]}>{t[app.status]}</Pill>
          </span>
          <span className="text-caption text-ink-muted">{about}</span>
          {app.for && (
            <span className="text-caption font-medium text-ink-muted">
              {t.forLabel(app.for.map((p) => t.forProfiles[p] ?? p))}
            </span>
          )}
        </span>
        {app.status !== 'planned' && (
          <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
        )}
      </span>
    </>
  );
  const box = 'block h-full px-5 py-4';
  if (app.key === 'verse')
    return (
      <button
        type="button"
        onClick={openPalette}
        className={cx(box, 'w-full text-left hover:bg-paper')}
      >
        {body}
      </button>
    );
  return app.href ? (
    <Link href={app.href} className={cx(box, 'hover:bg-paper')}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}
