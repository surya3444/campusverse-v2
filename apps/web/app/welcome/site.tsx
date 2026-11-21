// The public site's frame and building blocks, shared by the landing page and the product pages.
import logoColored from '@campusverse/ui/brand/logo-colored.svg';
import logoWhite from '@campusverse/ui/brand/logo-white.svg';
import { cx } from '@campusverse/ui';
import { ArrowRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { en } from '../../messages/en';

const t = en.landing;
export const SHELL = 'mx-auto w-full max-w-[1240px] px-4 sm:px-6';
export const FOCUS_DARK =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400';
export const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950';
export const DEMO = `mailto:${t.contact.email}?subject=${encodeURIComponent(t.contact.demoSubject)}`;

export function Eyebrow({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return (
    <p
      className={cx(
        'inline-flex items-center gap-2 text-caption font-semibold tracking-[0.14em] uppercase',
        dark ? 'text-cyan-200' : 'text-navy-700',
      )}
    >
      <span
        aria-hidden
        className={cx('size-1.5 rounded-full', dark ? 'bg-cyan-400' : 'bg-navy-950')}
      />
      {children}
    </p>
  );
}

export function SectionHead({
  id,
  eyebrow,
  title,
  lead,
  dark = false,
  center = false,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  dark?: boolean;
  center?: boolean;
}) {
  return (
    <div
      className={cx('flex max-w-3xl flex-col gap-4', center && 'mx-auto items-center text-center')}
    >
      <Eyebrow dark={dark}>{eyebrow}</Eyebrow>
      <h2
        id={id}
        className={cx(
          'font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.035em] sm:text-[2.75rem]',
          dark ? 'text-white' : 'text-ink',
        )}
      >
        {title}
      </h2>
      {lead && <p className={cx('text-lead', dark ? 'text-white/70' : 'text-ink-muted')}>{lead}</p>}
    </div>
  );
}

export function PrimaryLink({
  href,
  children,
  dark = false,
}: {
  href: string;
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(
        'inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-body font-semibold',
        dark
          ? 'bg-white text-navy-950 shadow-[0_10px_30px_-10px_rgb(10_197_255/0.6)] hover:bg-navy-50'
          : 'bg-navy-950 text-white shadow-[var(--shadow-button)] hover:bg-navy-900',
        dark ? FOCUS_DARK : FOCUS,
      )}
    >
      {children}
      <ArrowRight aria-hidden className="size-4" />
    </Link>
  );
}

export function SecondaryLink({
  href,
  children,
  dark = false,
}: {
  href: string;
  children: ReactNode;
  dark?: boolean;
}) {
  return (
    <a
      href={href}
      className={cx(
        'inline-flex h-12 items-center rounded-xl px-6 text-body font-semibold',
        dark
          ? 'text-white ring-1 ring-white/30 hover:bg-white/10'
          : 'bg-surface text-ink ring-1 ring-line hover:bg-navy-50',
        dark ? FOCUS_DARK : FOCUS,
      )}
    >
      {children}
    </a>
  );
}

export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-md bg-navy-950 px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
    >
      {t.nav.skip}
    </a>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-[var(--env-bar)] z-30 border-b border-line/70 bg-surface/85 backdrop-blur-md">
      <div className={cx(SHELL, 'flex h-16 items-center gap-6')}>
        <Link href="/" className={cx('shrink-0 rounded-md', FOCUS)}>
          <Image
            src={logoColored}
            alt={en.app.name}
            priority
            width={126}
            height={40}
            className="h-8 w-auto"
          />
        </Link>
        <nav aria-label={t.nav.menu} className="hidden flex-1 items-center gap-1 lg:flex">
          {(
            [
              ['/product', t.nav.systems],
              ['/#modules', t.nav.modules],
              ['/#segments', t.nav.segments],
              ['/#ai', t.nav.ai],
              ['/#pricing', t.nav.pricing],
            ] as const
          ).map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={cx(
                'rounded-lg px-3 py-2 text-body font-medium text-ink-muted transition-colors hover:bg-navy-50 hover:text-ink',
                FOCUS,
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className={cx(
              'rounded-lg px-3 py-2 text-body font-medium text-ink hover:bg-navy-50',
              FOCUS,
            )}
          >
            {t.nav.signIn}
          </Link>
          <a
            href={DEMO}
            className={cx(
              'hidden h-10 items-center rounded-lg px-4 text-body font-medium text-ink ring-1 ring-line hover:bg-navy-50 md:inline-flex',
              FOCUS,
            )}
          >
            {t.nav.demo}
          </a>
          <Link
            href="/signup"
            className={cx(
              'hidden h-10 items-center gap-1.5 rounded-lg bg-navy-950 px-4 text-body font-medium text-white shadow-[var(--shadow-button)] hover:bg-navy-900 sm:inline-flex',
              FOCUS,
            )}
          >
            {t.nav.start}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const year = new Date().getFullYear();
  const columns: [string, (readonly [string, string])[]][] = [
    [
      t.footer.product,
      [
        ['/product', t.nav.systems],
        ['/#modules', t.nav.modules],
        ['/#pricing', t.nav.pricing],
        ['/verify', t.footer.verify],
      ],
    ],
    [t.footer.segments, t.segments.items.map(([name]) => ['/#segments', name] as const)],
    [
      t.footer.account,
      [
        ['/signup', t.nav.start],
        ['/login', t.nav.signIn],
        [DEMO, t.nav.demo],
      ],
    ],
    [
      t.footer.contact,
      [
        [`mailto:${t.contact.email}`, t.contact.email],
        [`tel:${t.contact.phoneHref}`, t.contact.phone],
        ['https://www.instagram.com/campusverse.app', t.footer.instagram],
        ['https://www.linkedin.com/company/campus-verse', t.footer.linkedin],
      ],
    ],
  ];
  return (
    <footer className="midnight text-white">
      <div
        className={cx(
          SHELL,
          'grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]',
        )}
      >
        <div className="flex flex-col gap-4">
          <Image
            src={logoWhite}
            alt={en.app.name}
            width={126}
            height={40}
            className="h-8 w-auto self-start"
          />
          <p className="max-w-xs text-body text-white/70">{t.footer.tagline}</p>
        </div>
        {columns.map(([title, links]) => (
          <nav key={title} aria-label={title} className="flex flex-col gap-2">
            <p className="text-caption font-semibold tracking-wide text-white/70 uppercase">
              {title}
            </p>
            {links.map(([href, label]) => (
              <a
                key={label}
                href={href}
                {...(href.startsWith('http')
                  ? { target: '_blank', rel: 'noopener noreferrer' }
                  : {})}
                className={cx(
                  'w-fit rounded text-body break-all text-white/85 hover:text-white',
                  FOCUS_DARK,
                )}
              >
                {label}
              </a>
            ))}
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div
          className={cx(
            SHELL,
            'flex flex-wrap items-center justify-between gap-3 py-5 text-caption text-white/70',
          )}
        >
          <span>{t.footer.rights(year)}</span>
          <span>{t.footer.place}</span>
        </div>
      </div>
    </footer>
  );
}
