// Pieces of the product docs: the page head, facts, section titles, status and prev/next.
import { cx } from '@campusverse/ui';
import { ArrowLeft, ArrowRight, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { productText } from '../../messages/product';
import { DEMO, FOCUS_DARK } from '../welcome/site';

const p = productText;
export const LINK = cx('rounded text-cyan-200 underline-offset-4 hover:underline', FOCUS_DARK);

/** A status as a dot and a word: green live, amber rolling out, grey coming next. */
export function Status({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption font-medium text-white/85">
      <span
        aria-hidden
        className={cx(
          'size-1.5 rounded-full',
          status === 'live'
            ? 'bg-signal-go'
            : status === 'building'
              ? 'bg-signal-warn'
              : 'bg-white/40',
        )}
      />
      {p.status[status] ?? status}
    </span>
  );
}

export function DocHead({
  crumbs,
  title,
  lead,
  meta,
}: {
  crumbs: [string, string | null][];
  title: string;
  lead: string;
  meta?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-white/10 pb-8">
      <nav aria-label={p.nav.crumbs}>
        <ol className="flex flex-wrap items-center gap-1 text-caption text-white/65">
          {crumbs.map(([label, href], i) => (
            <li key={label} className="flex items-center gap-1">
              {i > 0 && <ChevronRight aria-hidden className="size-3" />}
              {href ? (
                <Link href={href} className={cx('rounded hover:text-white', FOCUS_DARK)}>
                  {label}
                </Link>
              ) : (
                <span aria-current="page" className="text-white/85">
                  {label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <h1 className="font-display text-[2.1rem] leading-[1.1] font-semibold tracking-[-0.03em] text-white sm:text-[2.6rem]">
        {title}
      </h1>
      <p className="max-w-3xl text-lead text-white/75">{lead}</p>
      {meta && <div className="flex flex-wrap items-center gap-x-5 gap-y-2">{meta}</div>}
    </header>
  );
}

/** Label and value rows, like a spec sheet. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
      {rows.map(([label, value]) => (
        <div key={label} className="grid sm:grid-cols-[12rem_minmax(0,1fr)]">
          <dt className="bg-white/[0.03] px-4 py-2.5 text-caption font-medium text-white/70">
            {label}
          </dt>
          <dd className="px-4 py-2.5 text-body text-white">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5 border-b border-white/10 py-10">
      <h2
        id={id}
        className="scroll-mt-28 font-display text-[1.35rem] font-semibold tracking-[-0.02em] text-white"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Previous and next pages, as docs have at the bottom. */
export function Pager({
  prev,
  next,
}: {
  prev?: { href: string; label: string } | undefined;
  next?: { href: string; label: string } | undefined;
}) {
  const cell = cx(
    'group flex flex-col gap-1 rounded-lg border border-white/10 p-4 transition-colors hover:border-white/30 hover:bg-white/[0.03]',
    FOCUS_DARK,
  );
  return (
    <nav aria-label={p.nav.pager} className="grid gap-3 pt-10 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className={cell}>
          <span className="flex items-center gap-1 text-caption text-white/65">
            <ArrowLeft aria-hidden className="size-3.5" />
            {p.nav.previous}
          </span>
          <span className="font-display font-semibold text-white">{prev.label}</span>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className={cx(cell, 'sm:items-end sm:text-right')}>
          <span className="flex items-center gap-1 text-caption text-white/65">
            {p.nav.next}
            <ArrowRight aria-hidden className="size-3.5" />
          </span>
          <span className="font-display font-semibold text-white">{next.label}</span>
        </Link>
      )}
    </nav>
  );
}

/** The quiet ask at the end of a page. */
export function DocCta() {
  return (
    <p className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 py-4 text-body text-white/80">
      {p.cta.lead}
      <Link href="/signup" className={LINK}>
        {p.cta.start}
      </Link>
      <a href={DEMO} className={LINK}>
        {p.cta.demo}
      </a>
    </p>
  );
}
