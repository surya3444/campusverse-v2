import { cx } from '@campusverse/ui';
import { ArrowRight, Check } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SYSTEMS } from '../../../lib/systems';
import { en } from '../../../messages/en';
import { productText, SYSTEM_CONTENT } from '../../../messages/product';
import { FOCUS_DARK } from '../../welcome/site';
import { DocCta, DocHead, Facts, LINK, Pager, Section, Status } from '../parts';
import { findSystem, moduleHref, slug, systemHref } from '../paths';

const p = productText;
const s = en.systems;
const appText = (key: string) =>
  (s.apps as Record<string, readonly [string, string]>)[key] ?? [key, ''];

export function generateStaticParams() {
  return SYSTEMS.map((sys) => ({ system: slug(sys.key) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ system: string }>;
}): Promise<Metadata> {
  const sys = findSystem((await params).system);
  if (!sys) return {};
  return {
    title: p.meta.system(s.groups[sys.key] ?? sys.key),
    description: SYSTEM_CONTENT[sys.key].overview,
  };
}

/** One system as a docs page: facts, its modules, the flow, what it gives, India rules. */
export default async function SystemPage({ params }: { params: Promise<{ system: string }> }) {
  const sys = findSystem((await params).system);
  if (!sys) notFound();
  const c = SYSTEM_CONTENT[sys.key];
  const name = s.groups[sys.key] ?? sys.key;
  const live = sys.apps.filter((a) => a.status === 'live').length;
  const i = SYSTEMS.indexOf(sys);
  const prev = SYSTEMS[i - 1];
  const next = SYSTEMS[i + 1];
  return (
    <>
      <DocHead
        crumbs={[
          [p.crumbs.home, '/'],
          [p.crumbs.product, '/product'],
          [name, null],
        ]}
        title={name}
        lead={c.headline}
      />

      <div className="flex flex-col gap-5 border-b border-white/10 py-10">
        <p className="max-w-3xl text-body text-white/75">{c.overview}</p>
        <Facts
          rows={[
            [p.facts.modules, p.overview.modules(live, sys.apps.length)],
            [p.facts.usedBy, c.roles.join(', ')],
            [
              p.facts.connects,
              <span key="c" className="flex flex-wrap gap-x-3 gap-y-1">
                {c.connects.map(([key]) => (
                  <Link key={key} href={systemHref(key)} className={LINK}>
                    {s.groups[key]}
                  </Link>
                ))}
              </span>,
            ],
          ]}
        />
      </div>

      <Section id="modules" title={p.system.modules}>
        <div className="overflow-hidden rounded-lg border border-white/10">
          <div
            aria-hidden
            className="hidden grid-cols-[13rem_minmax(0,1fr)_7rem] gap-4 border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-caption font-medium text-white/70 md:grid"
          >
            <span>{p.table.module}</span>
            <span>{p.table.what}</span>
            <span>{p.table.status}</span>
          </div>
          <ul className="divide-y divide-white/10">
            {sys.apps.map((m) => {
              const [mName, body] = appText(m.key);
              return (
                <li key={m.key}>
                  <Link
                    href={moduleHref(sys.key, m.key)}
                    className={cx(
                      'grid gap-1 px-4 py-3 transition-colors hover:bg-white/[0.04] md:grid-cols-[13rem_minmax(0,1fr)_7rem] md:items-baseline md:gap-4',
                      FOCUS_DARK,
                    )}
                  >
                    <span className="font-medium text-white">{mName}</span>
                    <span className="text-body text-white/70">{body}</span>
                    <Status status={m.status} />
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </Section>

      <Section id="flow" title={p.system.journey}>
        <ol className="grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
          {c.journey.map(([title, body], n) => (
            <li key={title} className="flex flex-col gap-1.5 bg-navy-900 p-4">
              <span className="tabular font-mono text-caption text-cyan-200">
                {String(n + 1).padStart(2, '0')}
              </span>
              <span className="font-display font-semibold text-white">{title}</span>
              <span className="text-caption text-white/70">{body}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="outcomes" title={p.system.outcomes}>
        <ul className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          {c.outcomes.map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <Check aria-hidden className="mt-1 size-4 shrink-0 text-cyan-200" />
              <span>
                <span className="block font-medium text-white">{title}</span>
                <span className="block text-body text-white/70">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="connects" title={p.system.connects}>
        <ul className="flex flex-col gap-2">
          {c.connects.map(([key, body]) => (
            <li key={key} className="flex flex-wrap items-baseline gap-x-3 text-body">
              <Link
                href={systemHref(key)}
                className={cx(LINK, 'inline-flex items-center gap-1 font-medium')}
              >
                {s.groups[key]}
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
              <span className="text-white/70">{body}</span>
            </li>
          ))}
        </ul>
      </Section>

      {c.india.length > 0 && (
        <Section id="india" title={p.system.india}>
          <ul className="flex flex-col gap-2">
            {c.india.map((x) => (
              <li key={x} className="flex gap-3 text-body text-white/85">
                <Check aria-hidden className="mt-1 size-4 shrink-0 text-cyan-200" />
                {x}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Pager
        prev={
          prev
            ? { href: systemHref(prev.key), label: s.groups[prev.key] ?? '' }
            : { href: '/product', label: p.nav.overview }
        }
        next={next ? { href: systemHref(next.key), label: s.groups[next.key] ?? '' } : undefined}
      />
      <DocCta />
    </>
  );
}
