'use client';

import type { AttendanceDay } from '@campusverse/school-attendance';
import type { DayCloseView, Dues } from '@campusverse/shared-finance';
import {
  EmptyState,
  KeyFigures,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  type KeyFigure,
} from '@campusverse/ui';
import { useQueries } from '@tanstack/react-query';
import { ArrowRight, Building2, School, Settings2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiFailure, api } from '../../../lib/api';
import { rupees } from '../../../lib/money';
import { chooseInstitution } from '../../../lib/scope';
import { campusesIn, useView } from '../../../lib/view';
import { en } from '../../../messages/en';

const t = en.orgOverview;
const num = new Intl.NumberFormat('en-IN');

type Tree = {
  organisation: { orgId: string; name: string };
  campuses: {
    campusId: string;
    name: string;
    city: string | null;
    institutions: { institutionId: string; name: string; type: string; status: string }[];
  }[];
};

type Today = {
  /** Null when this person may not see it (403) or it failed. */
  enrolled: number | null;
  present: number | null;
  marked: { done: number; of: number } | null;
  holiday: boolean;
  collectedPaise: number | null;
  overduePaise: number | null;
  overdueStudents: number | null;
};

const quiet = (e: unknown, n: number) => !(e instanceof ApiFailure && e.status === 403) && n < 1;

/** One school's day, from the same module reads as its Today page. */
async function todayOf(id: string): Promise<Today> {
  const [att, cash, dues] = await Promise.allSettled([
    api.get<AttendanceDay>(`/school/attendance/${id}/day`),
    api.get<DayCloseView>(`/finance/${id}/day`),
    api.get<Dues>(`/finance/${id}/dues`),
  ]);
  const a = att.status === 'fulfilled' ? att.value : null;
  const sections = a?.sections ?? [];
  const done = sections.filter((s) => s.state === 'submitted' || s.state === 'signed_off');
  const c = cash.status === 'fulfilled' ? cash.value : null;
  const d = dues.status === 'fulfilled' ? Object.values(dues.value.buckets) : null;
  return {
    enrolled: a ? sections.reduce((n, s) => n + s.students, 0) : null,
    present: a ? done.reduce((n, s) => n + s.students - s.absent, 0) : null,
    marked: a && sections.length ? { done: done.length, of: sections.length } : null,
    holiday: !!a?.holiday,
    collectedPaise: c ? c.cash.paise + c.cheques.paise + c.digital.paise : null,
    overduePaise: d ? d.reduce((n, b) => n + b.paise, 0) : null,
    overdueStudents: d ? d.reduce((n, b) => n + b.students, 0) : null,
  };
}

const sum = (xs: (number | null | undefined)[]) =>
  xs.some((x) => typeof x === 'number')
    ? xs.reduce<number>((n, x) => n + (typeof x === 'number' ? x : 0), 0)
    : null;

/**
 * The organisation at a glance for its owner: every campus and school with today's attendance
 * and money, and one click into any school.
 */
export function OrganisationOverview() {
  const router = useRouter();
  // The person's view: the whole organisation, or the campuses or institutions they chose.
  const view = useView();
  const tree = {
    ...view,
    data: view.data
      ? ({ organisation: view.data.organisation, campuses: campusesIn(view.data) } satisfies Tree)
      : undefined,
  };
  const schools = (tree.data?.campuses ?? []).flatMap((c) => c.institutions);
  const days = useQueries({
    queries: schools.map((s) => ({
      queryKey: ['org-today', s.institutionId],
      queryFn: () => todayOf(s.institutionId),
      retry: quiet,
    })),
  });
  const dayOf = new Map(schools.map((s, i) => [s.institutionId, days[i]?.data]));
  const loading = days.some((d) => d.isPending);
  const all = [...dayOf.values()];

  const open = (id: string, href = '/') => {
    chooseInstitution(id);
    router.push(href);
  };

  if (tree.isPending) return <SkeletonRows rows={6} label={en.states.loading.title} />;
  if (tree.isError || !tree.data)
    return tree.error instanceof ApiFailure && tree.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} />
    );

  const enrolled = sum(all.map((d) => d?.enrolled));
  const present = sum(all.map((d) => d?.present));
  const collected = sum(all.map((d) => d?.collectedPaise));
  const overdue = sum(all.map((d) => d?.overduePaise));
  const figures: KeyFigure[] = [
    {
      label: t.campuses,
      value: num.format(tree.data.campuses.length),
      note: t.schoolsNote(schools.length),
    },
    ...(enrolled !== null
      ? [
          {
            label: t.present,
            value: present === null ? '—' : num.format(present),
            note: t.ofEnrolled(num.format(enrolled)),
          },
        ]
      : []),
    ...(collected !== null
      ? [{ label: t.collected, value: rupees(collected), note: t.acrossSchools }]
      : []),
    ...(overdue !== null
      ? [
          {
            label: t.overdue,
            value: rupees(overdue),
            note: t.students(sum(all.map((d) => d?.overdueStudents)) ?? 0),
            tone: overdue > 0 ? ('warn' as const) : ('go' as const),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Building2}
        art="welcome"
        area="navy"
        eyebrow={
          view.data && view.data.level !== 'organisation'
            ? `${en.nav.allInstitutions} · ${en.view.levels[view.data.level]}`
            : en.nav.allInstitutions
        }
        title={tree.data.organisation.name}
        description={t.lead}
        actions={
          <Link
            href="/settings/organisation"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
          >
            <Settings2 aria-hidden className="size-4" />
            {t.manage}
          </Link>
        }
      />
      <KeyFigures figures={figures} label={t.figures} loading={loading} />
      {tree.data.campuses.length === 0 ? (
        <div className="panel">
          <EmptyState art="setup" title={t.empty} body={t.emptyBody} />
        </div>
      ) : (
        tree.data.campuses.map((c) => (
          <Section
            key={c.campusId}
            id={`campus-${c.campusId}`}
            title={c.name}
            description={[c.city, t.schoolsNote(c.institutions.length)].filter(Boolean).join(' · ')}
            flush
          >
            {c.institutions.length === 0 ? (
              <EmptyState compact art="setup" title={t.noSchools} />
            ) : (
              <>
                <ul className="divide-y divide-line sm:hidden">
                  {c.institutions.map((s) => {
                    const d = dayOf.get(s.institutionId);
                    const dash = loading && !d ? '…' : '—';
                    return (
                      <li key={s.institutionId} className="flex flex-col gap-2 px-5 py-4">
                        <div className="flex items-start gap-3">
                          <span className="flex min-w-0 flex-1 flex-col">
                            <span className="font-medium text-ink">{s.name}</span>
                            <span className="text-caption text-ink-muted">
                              {en.settings.statuses[s.status] ?? s.status}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => open(s.institutionId)}
                            aria-label={`${t.open}: ${s.name}`}
                            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body font-medium text-navy-950 hover:bg-navy-50"
                          >
                            {t.open}
                            <ArrowRight aria-hidden className="size-4" />
                          </button>
                        </div>
                        <dl className="grid grid-cols-2 gap-2 text-caption">
                          <div>
                            <dt className="text-ink-muted">{t.enrolled}</dt>
                            <dd className="tabular text-body text-ink">
                              {d?.enrolled != null ? num.format(d.enrolled) : dash}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-ink-muted">{t.attendance}</dt>
                            <dd className="text-body text-ink">
                              {d?.holiday
                                ? t.holiday
                                : d?.marked
                                  ? t.marked(d.marked.done, d.marked.of)
                                  : dash}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-ink-muted">{t.collected}</dt>
                            <dd className="tabular text-body text-ink">
                              {d?.collectedPaise != null ? rupees(d.collectedPaise) : dash}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-ink-muted">{t.overdue}</dt>
                            <dd className="tabular text-body text-ink">
                              {d?.overduePaise != null ? rupees(d.overduePaise) : dash}
                            </dd>
                          </div>
                        </dl>
                      </li>
                    );
                  })}
                </ul>
                <div className="hidden overflow-x-auto sm:block">
                  <table className="w-full min-w-[720px] text-body">
                    <caption className="sr-only">{c.name}</caption>
                    <thead>
                      <tr className="border-b border-line bg-paper text-left text-caption text-ink-muted">
                        <th scope="col" className="px-5 py-2 font-medium">
                          {t.school}
                        </th>
                        <th scope="col" className="px-5 py-2 text-right font-medium">
                          {t.enrolled}
                        </th>
                        <th scope="col" className="px-5 py-2 font-medium">
                          {t.attendance}
                        </th>
                        <th scope="col" className="px-5 py-2 text-right font-medium">
                          {t.collected}
                        </th>
                        <th scope="col" className="px-5 py-2 text-right font-medium">
                          {t.overdue}
                        </th>
                        <th scope="col" className="px-5 py-2">
                          <span className="sr-only">{t.open}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {c.institutions.map((s) => {
                        const d = dayOf.get(s.institutionId);
                        const dash = loading && !d ? '…' : '—';
                        return (
                          <tr key={s.institutionId}>
                            <th scope="row" className="px-5 py-3 text-left font-normal">
                              <span className="flex items-center gap-3">
                                <School aria-hidden className="size-4 shrink-0 text-ink-muted" />
                                <span className="flex flex-col">
                                  <span className="font-medium text-ink">{s.name}</span>
                                  <span className="text-caption text-ink-muted">
                                    {en.settings.statuses[s.status] ?? s.status}
                                  </span>
                                </span>
                              </span>
                            </th>
                            <td className="tabular px-5 py-3 text-right text-ink">
                              {d?.enrolled != null ? num.format(d.enrolled) : dash}
                            </td>
                            <td className="px-5 py-3">
                              {d?.holiday ? (
                                <Pill>{t.holiday}</Pill>
                              ) : d?.marked ? (
                                <Pill tone={d.marked.done === d.marked.of ? 'go' : 'warn'}>
                                  {t.marked(d.marked.done, d.marked.of)}
                                </Pill>
                              ) : (
                                <span className="text-ink-muted">{dash}</span>
                              )}
                            </td>
                            <td className="tabular px-5 py-3 text-right text-ink">
                              {d?.collectedPaise != null ? rupees(d.collectedPaise) : dash}
                            </td>
                            <td className="tabular px-5 py-3 text-right text-ink">
                              {d?.overduePaise != null ? rupees(d.overduePaise) : dash}
                            </td>
                            <td className="px-5 py-3 text-right">
                              <button
                                type="button"
                                onClick={() => open(s.institutionId)}
                                aria-label={`${t.open}: ${s.name}`}
                                className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-body font-medium whitespace-nowrap text-navy-950 hover:bg-navy-50"
                              >
                                {t.open}
                                <ArrowRight aria-hidden className="size-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Section>
        ))
      )}
    </div>
  );
}
