// The landing page's view of the platform: systems in a bordered grid, modules as a directory.
import { cx } from '@campusverse/ui';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { SYSTEMS } from '../../lib/systems';
import { en } from '../../messages/en';
import { productText } from '../../messages/product';
import { FOCUS } from '../welcome/site';
import { moduleHref, systemHref } from './paths';

const s = en.systems;
const t = en.landing.systems;

export function SystemsGrid() {
  return (
    <ul className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {SYSTEMS.map((sys) => {
        const live = sys.apps.filter((a) => a.status === 'live').length;
        return (
          <li key={sys.key} className="bg-surface">
            <Link
              href={systemHref(sys.key)}
              className={cx(
                'group flex h-full flex-col gap-3 p-6 transition-colors hover:bg-paper',
                FOCUS,
              )}
            >
              <span className="flex items-center justify-between text-caption text-ink-muted">
                <sys.Icon aria-hidden className="size-5 text-navy-950" />
                <span className="tabular">{t.count(live, sys.apps.length)}</span>
              </span>
              <span className="font-display text-lead font-semibold text-ink">
                {s.groups[sys.key]}
              </span>
              <span className="text-body text-ink-muted">{s.taglines[sys.key]}</span>
              <span className="mt-auto inline-flex items-center gap-1 pt-2 text-caption font-semibold text-navy-950 opacity-70 transition group-hover:opacity-100">
                {t.open}
                <ArrowRight
                  aria-hidden
                  className="size-3.5 transition group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          </li>
        );
      })}
      <li className="bg-navy-950">
        <Link
          href="/product"
          className={cx(
            'group flex h-full flex-col justify-between gap-6 p-6 text-white',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400',
          )}
        >
          <ArrowUpRight
            aria-hidden
            className="size-5 text-cyan-200 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          />
          <span className="font-display text-lead font-semibold">{t.all}</span>
        </Link>
      </li>
    </ul>
  );
}

/** Every module, as a directory: one column per system. */
export function ModuleDirectory() {
  return (
    <div className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
      {SYSTEMS.map((sys) => (
        <div key={sys.key} className="flex flex-col gap-3">
          <Link
            href={systemHref(sys.key)}
            className={cx(
              'flex items-center gap-2 border-b border-line pb-2 text-caption font-semibold tracking-wide text-ink uppercase hover:text-navy-950',
              FOCUS,
            )}
          >
            <sys.Icon aria-hidden className="size-3.5" />
            {s.groups[sys.key]}
          </Link>
          <ul className="flex flex-col gap-1.5">
            {sys.apps.map((m) => {
              const [name] = (s.apps as Record<string, readonly [string, string]>)[m.key] ?? [
                m.key,
              ];
              return (
                <li key={m.key}>
                  <Link
                    href={moduleHref(sys.key, m.key)}
                    className={cx(
                      'group flex items-baseline gap-2 rounded text-body',
                      m.status === 'live' ? 'text-ink' : 'text-ink-muted',
                      FOCUS,
                    )}
                  >
                    <span className="underline-offset-4 group-hover:text-navy-950 group-hover:underline">
                      {name}
                    </span>
                    {m.status !== 'live' && (
                      <span className="shrink-0 text-[0.6875rem] text-ink-muted">
                        {productText.status[m.status]}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
