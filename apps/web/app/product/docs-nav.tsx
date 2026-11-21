'use client';

// The product docs' sidebar: every system with its modules, the current page marked.
import { cx } from '@campusverse/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SYSTEMS } from '../../lib/systems';
import { en } from '../../messages/en';
import { productText } from '../../messages/product';
import { moduleHref, systemHref } from './paths';

const s = en.systems;
const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400';

function Links() {
  const path = usePathname();
  return (
    <ul className="flex flex-col gap-6">
      <li>
        <Link
          href="/product"
          aria-current={path === '/product' ? 'page' : undefined}
          className={cx(
            'block rounded-md px-2 py-1 text-body font-medium',
            path === '/product' ? 'bg-white/10 text-white' : 'text-white/75 hover:text-white',
            FOCUS,
          )}
        >
          {productText.nav.overview}
        </Link>
      </li>
      {SYSTEMS.map((sys) => {
        const href = systemHref(sys.key);
        return (
          <li key={sys.key}>
            <Link
              href={href}
              aria-current={path === href ? 'page' : undefined}
              className={cx(
                'flex items-center gap-2 rounded-md px-2 py-1 text-caption font-semibold tracking-wide uppercase',
                path === href ? 'bg-white/10 text-white' : 'text-white/70 hover:text-white',
                FOCUS,
              )}
            >
              <sys.Icon aria-hidden className="size-3.5" />
              {s.groups[sys.key]}
            </Link>
            <ul className="mt-1.5 ml-[0.95rem] flex flex-col border-l border-white/10">
              {sys.apps.map((m) => {
                const mh = moduleHref(sys.key, m.key);
                const here = path === mh;
                const [name] = (s.apps as Record<string, readonly [string, string]>)[m.key] ?? [
                  m.key,
                ];
                return (
                  <li key={m.key}>
                    <Link
                      href={mh}
                      aria-current={here ? 'page' : undefined}
                      className={cx(
                        '-ml-px flex items-center gap-2 border-l py-1 pr-2 pl-3.5 text-body',
                        here
                          ? 'border-cyan-200 text-white'
                          : 'border-transparent text-white/70 hover:border-white/40 hover:text-white',
                        FOCUS,
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {m.status !== 'live' && (
                        <span className="shrink-0 text-[0.6875rem] text-white/65">
                          {productText.status[m.status]}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

export function DocsNav() {
  return (
    <>
      {/* Phones: the same list behind a disclosure. */}
      <details className="rounded-lg border border-white/10 lg:hidden">
        <summary className={cx('cursor-pointer px-4 py-3 text-body font-medium text-white', FOCUS)}>
          {productText.nav.browse}
        </summary>
        <nav aria-label={productText.nav.label} className="border-t border-white/10 p-4">
          <Links />
        </nav>
      </details>
      <nav
        aria-label={productText.nav.label}
        className="sticky top-[calc(var(--env-bar)+4rem)] hidden max-h-[calc(100dvh-var(--env-bar)-4rem)] overflow-y-auto py-10 pr-4 lg:block"
      >
        <Links />
      </nav>
    </>
  );
}
