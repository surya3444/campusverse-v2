import { cx } from '@campusverse/ui';
import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SYSTEMS } from '../../../../lib/systems';
import { en } from '../../../../messages/en';
import { MODULE_CONTENT, productText } from '../../../../messages/product';
import { DocCta, DocHead, Facts, LINK, Pager, Section, Status } from '../../parts';
import { findModule, moduleHref, slug, systemHref, systemOf } from '../../paths';

const p = productText;
const s = en.systems;
const appText = (key: string) =>
  (s.apps as Record<string, readonly [string, string]>)[key] ?? [key, ''];
/** Real screens, where a module has one. */
const SHOTS: Record<string, { src: string; width: number; height: number }> = {
  timetable: { src: '/landing/timetable-generator.png', width: 1151, height: 867 },
};

export function generateStaticParams() {
  return SYSTEMS.flatMap((sys) =>
    sys.apps.map((m) => ({ system: slug(sys.key), module: slug(m.key) })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ system: string; module: string }>;
}): Promise<Metadata> {
  const { system, module } = await params;
  const found = findModule(system, module);
  if (!found) return {};
  const [name, body] = appText(found.module.key);
  return {
    title: p.meta.module(name, s.groups[found.system.key] ?? ''),
    description: MODULE_CONTENT[found.module.key]?.overview ?? body,
  };
}

/** One module as a docs page; a module not built yet says so and what it will do. */
export default async function ModulePage({
  params,
}: {
  params: Promise<{ system: string; module: string }>;
}) {
  const { system, module } = await params;
  const found = findModule(system, module);
  if (!found) notFound();
  const { system: sys, module: m } = found;
  const [name, body] = appText(m.key);
  const sysName = s.groups[sys.key] ?? sys.key;
  const c = MODULE_CONTENT[m.key];
  const shot = SHOTS[m.key];
  const profiles = m.for ? m.for.map((x) => s.forProfiles[x] ?? x).join(', ') : p.allProfiles;
  const i = sys.apps.indexOf(m);
  const prev = sys.apps[i - 1];
  const next = sys.apps[i + 1];
  const related = (c?.related ?? []).flatMap((key) => {
    const rs = systemOf(key);
    return rs ? [{ key, rs }] : [];
  });

  return (
    <>
      <DocHead
        crumbs={[
          [p.crumbs.home, '/'],
          [p.crumbs.product, '/product'],
          [sysName, systemHref(sys.key)],
          [name, null],
        ]}
        title={name}
        lead={c?.tagline ?? body}
      />

      <div className="flex flex-col gap-5 border-b border-white/10 py-10">
        <p className="max-w-3xl text-body text-white/75">
          {c?.overview ?? (m.status === 'building' ? p.module.buildingLead : p.module.comingLead)}
        </p>
        <Facts
          rows={[
            [p.facts.status, <Status key="s" status={m.status} />],
            [p.facts.for, profiles],
            [
              p.facts.partOf,
              <Link key="p" href={systemHref(sys.key)} className={LINK}>
                {sysName}
              </Link>,
            ],
            ...(c
              ? ([[p.facts.usedBy, c.roles.map(([r]) => r).join(', ')]] as [string, string][])
              : []),
            ...(related.length
              ? ([
                  [
                    p.facts.worksWith,
                    <span key="w" className="flex flex-wrap gap-x-3 gap-y-1">
                      {related.map(({ key, rs }) => (
                        <Link key={key} href={moduleHref(rs.key, key)} className={LINK}>
                          {appText(key)[0]}
                        </Link>
                      ))}
                    </span>,
                  ],
                ] as [string, React.ReactNode][])
              : []),
          ]}
        />
        {shot && (
          <Image
            src={shot.src}
            alt={c?.capabilities[3]?.[1] ?? body}
            width={shot.width}
            height={shot.height}
            sizes="(min-width: 1024px) 860px, 100vw"
            className="h-auto w-full rounded-lg border border-white/10"
          />
        )}
      </div>

      {c ? (
        <>
          <Section id="capabilities" title={p.module.capabilities}>
            <dl className="grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-2">
              {c.capabilities.map(([title, text]) => (
                <div key={title} className="bg-navy-900 p-4">
                  <dt className="font-medium text-white">{title}</dt>
                  <dd className="mt-1 text-body text-white/70">{text}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="steps" title={p.module.steps}>
            <ol className="flex flex-col">
              {c.steps.map(([title, text], n) => (
                <li
                  key={title}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 border-l border-white/10 pb-5 pl-0 last:pb-0"
                >
                  <span className="tabular -ml-3 flex size-6 items-center justify-center rounded-full bg-navy-950 font-mono text-[0.6875rem] text-cyan-200 ring-1 ring-white/15">
                    {n + 1}
                  </span>
                  <span>
                    <span className="block font-medium text-white">{title}</span>
                    <span className="block text-body text-white/70">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="guardrails" title={p.module.guardrails}>
            <ul className="flex flex-col gap-2">
              {c.guardrails.map((g) => (
                <li key={g} className="flex gap-3 text-body text-white/85">
                  <Check aria-hidden className="mt-1 size-4 shrink-0 text-cyan-200" />
                  {g}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="roles" title={p.module.roles}>
            <dl className="divide-y divide-white/10 overflow-hidden rounded-lg border border-white/10">
              {c.roles.map(([role, what]) => (
                <div
                  key={role}
                  className="grid gap-1 px-4 py-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4"
                >
                  <dt className="font-medium text-white">{role}</dt>
                  <dd className="text-body text-white/70">{what}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </>
      ) : (
        <Section id="planned" title={p.module.planned}>
          <p className={cx('flex gap-3 text-lead text-white/85')}>
            <Check aria-hidden className="mt-1.5 size-4 shrink-0 text-cyan-200" />
            {body}
          </p>
        </Section>
      )}

      <Pager
        prev={
          prev
            ? { href: moduleHref(sys.key, prev.key), label: appText(prev.key)[0] }
            : { href: systemHref(sys.key), label: sysName }
        }
        next={
          next ? { href: moduleHref(sys.key, next.key), label: appText(next.key)[0] } : undefined
        }
      />
      <DocCta />
    </>
  );
}
