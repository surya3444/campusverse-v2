'use client';

import type { StudentListItem } from '@campusverse/people-records';
import {
  Avatar,
  Button,
  EmptyState,
  PageHeader,
  Pill,
  Segmented,
  SkeletonRows,
  StatePanel,
  KeyFigures,
  type Tone,
} from '@campusverse/ui';
import { useQueries } from '@tanstack/react-query';
import { ChevronRight, Download, Phone, Search, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { exportCsv } from '../../../lib/csv';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { failureText, formatDate } from '../setup/shared';
import { useYears } from '../exams/shared';

/** Last day of a year whose end is exclusive. */
const lastDay = (ends: string) =>
  new Date(Date.parse(`${ends}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

const t = en.students;

export const STATUS_TONE: Record<string, Tone> = {
  active: 'go',
  on_leave: 'warn',
  applicant: 'neutral',
  left: 'neutral',
  passed_out: 'neutral',
  alumni: 'neutral',
};

const PAGE = 100;

const select =
  'h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink shadow-[var(--shadow-card)] outline-none focus:border-navy-950';

export function StudentsList() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  // Classes and sections links here with ?class=Class 1-A.
  const params = useSearchParams();
  const [klass, setKlass] = useState(params.get('class') ?? '');
  const [show, setShow] = useState<'active' | 'all'>('active');
  // Search after typing pauses, not on every key.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const schools = useInstitution();
  const institutionId = schools.institutionId;
  // Colleges and universities speak of batches and register numbers (rule book §12.3).
  const isSchool = !schools.profile || schools.profile === 'school';
  const w = isSchool ? t : { ...t, ...t.he };
  // A past (or next) school year: who was on the rolls then, and in which class.
  const years = useYears(isSchool ? institutionId : undefined);
  const [yearId, setYearId] = useState('');
  const year = (years.data?.years ?? []).find((y) => y.yearId === yearId);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const onDate =
    year && year.status !== 'active' ? [year.starts, today, lastDay(year.ends)].sort()[1] : null;
  // A view with several institutions (a campus, or the whole organisation) lists everyone in it,
  // each with their institution; "This institution" narrows to the one in the switcher.
  const many = schools.inView.length > 1;
  const [span, setSpan] = useState<'view' | 'one'>('view');
  const wide = many && span === 'view';
  const ids = wide ? schools.inView.map((i) => i.id) : institutionId ? [institutionId] : [];
  const names = new Map(schools.inView.map((i) => [i.id, i.name]));
  // The whole school comes at once (a few thousand rows at most), so search and filters see everyone.
  const students = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['students', id, show, wide ? null : onDate],
      queryFn: () =>
        api.get<StudentListItem[]>(
          `/people/students?institutionId=${id}${
            !wide && onDate ? `&onDate=${onDate}` : show === 'all' ? '&everyone=1' : ''
          }`,
        ),
    })),
    combine: (rs) => ({
      data:
        rs.length > 0 && rs.every((r) => r.data)
          ? rs.flatMap((r, n) =>
              (r.data ?? []).map((x) => ({
                ...x,
                institutionId: ids[n] ?? '',
                institution: names.get(ids[n] ?? '') ?? '',
              })),
            )
          : undefined,
      isPending: rs.length === 0 || rs.some((r) => r.isPending),
      isError: rs.some((r) => r.isError),
      error: rs.find((r) => r.error)?.error ?? null,
    }),
  });
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [query, klass, show]);

  const classes = useMemo(
    () =>
      [...new Set((students.data ?? []).map((s) => s.placement).filter((p) => p !== null))].sort(
        (a, b) => a.localeCompare(b, 'en', { numeric: true }),
      ),
    [students.data],
  );
  const q = query.toLowerCase();
  const matching = (students.data ?? []).filter(
    (s) =>
      (show === 'all' || s.status === 'active') &&
      (!klass || s.placement === klass) &&
      (!q || s.name.toLowerCase().includes(q) || (s.reference ?? '').toLowerCase().includes(q)),
  );
  const shown = matching.slice(0, limit);
  const filtering = !!query || !!klass || show !== 'active' || !!onDate;
  const nothingAtAll = !filtering && (students.data?.length ?? 0) === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Users}
        art="students"
        eyebrow={en.nav.groups.people}
        area="sky"
        title={t.title}
        description={w.lead}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!institutionId || matching.length === 0}
              onClick={() =>
                void exportCsv(
                  'students',
                  institutionId ?? '',
                  `students${klass ? `-${klass}` : ''}`,
                  [
                    ...(wide ? [en.view.institution] : []),
                    w.admissionNumber,
                    t.name,
                    w.placement,
                    t.status,
                  ],
                  matching.map((s) => [
                    ...(wide ? [s.institution] : []),
                    s.reference,
                    s.name,
                    s.placement,
                    t.statuses[s.status] ?? s.status,
                  ]),
                )
              }
            >
              <Download aria-hidden className="size-4" />
              {t.download}
            </Button>
            <Link
              href="/setup"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-navy-950 px-4 text-body font-medium text-white shadow-[var(--shadow-button)] hover:bg-navy-950/90"
            >
              <UserPlus aria-hidden className="size-4" />
              {t.importAction}
            </Link>
          </>
        }
      />

      {schools.isError || students.isError ? (
        <StatePanel kind="error" title={failureText(schools.error ?? students.error)} />
      ) : nothingAtAll && !students.isPending ? (
        <div className="panel">
          <EmptyState
            art="students"
            area="sky"
            title={t.emptyTitle}
            body={t.emptyBody}
            tips={t.emptyTips}
            actions={
              <>
                <Link
                  href="/setup"
                  className="inline-flex h-10 items-center rounded-md bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-900"
                >
                  {t.importAction}
                </Link>
                <Link
                  href="/admissions?new=1"
                  className="inline-flex h-10 items-center gap-2 rounded-md px-4 text-body font-medium text-navy-950 hover:bg-navy-50"
                >
                  <UserPlus aria-hidden className="size-4" />
                  {t.enquiryAction}
                </Link>
              </>
            }
          />
        </div>
      ) : (
        <>
          <KeyFigures
            variant="strip"
            label={t.title}
            loading={students.isPending}
            figures={[
              { label: t.figures.total, value: String(students.data?.length ?? 0) },
              {
                label: t.figures.active,
                value: String(students.data?.filter((x) => x.status === 'active').length ?? 0),
                tone: 'go',
              },
              { label: t.figures.inView, value: String(matching.length) },
              { label: w.classesFigure, value: String(classes.length) },
            ]}
          />
          <section aria-labelledby="directory-title" className="panel overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 px-6 py-5">
              <h2
                id="directory-title"
                className="mr-auto font-display text-[1.25rem] font-semibold text-ink"
              >
                {t.directory}
              </h2>
              <label className="flex h-10 w-full items-center gap-2 rounded-xl bg-navy-50/60 px-3 focus-within:ring-2 focus-within:ring-navy-950/20 sm:w-64">
                <Search aria-hidden className="size-4 shrink-0 text-ink-muted" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={w.search}
                  aria-label={w.search}
                  className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
                />
              </label>
              {many && (
                <Segmented
                  label={en.view.span}
                  value={span}
                  onChange={(v) => {
                    setSpan(v);
                    setKlass('');
                  }}
                  options={[
                    { value: 'view', label: en.view.spanView(schools.inView.length) },
                    { value: 'one', label: en.view.spanOne },
                  ]}
                />
              )}
              {!wide && isSchool && (years.data?.years.length ?? 0) > 1 && (
                <select
                  aria-label={t.yearFilter}
                  value={
                    yearId || (years.data?.years.find((y) => y.status === 'active')?.yearId ?? '')
                  }
                  onChange={(e) => {
                    setYearId(e.target.value);
                    setKlass('');
                  }}
                  className={select}
                >
                  {[...(years.data?.years ?? [])].reverse().map((y) => (
                    <option key={y.yearId} value={y.yearId}>
                      {y.label}
                    </option>
                  ))}
                </select>
              )}
              <select
                aria-label={w.classFilter}
                value={klass}
                onChange={(e) => setKlass(e.target.value)}
                className={select}
              >
                <option value="">{w.allClasses}</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {onDate ? (
                <p className="w-full text-caption text-ink-muted">{t.asOf(formatDate(onDate))}</p>
              ) : (
                <Segmented
                  label={t.statusFilter}
                  value={show}
                  onChange={setShow}
                  options={[
                    { value: 'active', label: t.filters.active ?? '' },
                    { value: 'all', label: t.filters.all ?? '' },
                  ]}
                />
              )}
            </div>
            {students.isPending || schools.isPending ? (
              <SkeletonRows label={en.states.loading.title} rows={6} />
            ) : matching.length === 0 ? (
              <EmptyState
                compact
                art="search"
                title={t.noMatchTitle}
                actions={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSearch('');
                      setKlass('');
                      setShow('active');
                    }}
                  >
                    {t.clearFilters}
                  </Button>
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-body">
                    <caption className="sr-only">{t.title}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="px-6 py-3.5 text-left">
                          {t.student}
                        </th>
                        {wide && (
                          <th scope="col" className="px-4 py-3.5 text-left">
                            {en.view.institution}
                          </th>
                        )}
                        <th scope="col" className="px-4 py-3.5 text-left">
                          {w.placement}
                        </th>
                        <th scope="col" className="hidden px-4 py-3.5 text-left md:table-cell">
                          {t.guardianColumn}
                        </th>
                        <th scope="col" className="px-6 py-3.5 text-right">
                          {t.status}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {shown.map((s) => (
                        <tr
                          key={`${s.personId}-${s.institutionId}`}
                          className="group relative transition-colors hover:bg-navy-50/40"
                        >
                          <td className="px-6 py-3.5">
                            <Link
                              href={`/students/${s.personId}`}
                              className="flex min-w-0 items-center gap-3 after:absolute after:inset-0"
                            >
                              <Avatar
                                name={s.name}
                                size="lg"
                                src={
                                  s.photoFileId
                                    ? `/api/v1/people/${s.personId}/photo?v=${s.photoFileId}`
                                    : null
                                }
                              />
                              <span className="flex min-w-0 flex-col">
                                <span className="truncate text-[0.9375rem] font-medium text-ink group-hover:text-navy-950">
                                  {s.name}
                                </span>
                                <span className="tabular truncate font-mono text-caption text-ink-muted">
                                  {s.reference ?? '—'}
                                </span>
                              </span>
                            </Link>
                          </td>
                          {wide && <td className="px-4 py-3.5 text-ink">{s.institution}</td>}
                          <td className="px-4 py-3.5 text-ink">{s.placement ?? '—'}</td>
                          <td className="hidden px-4 py-3.5 md:table-cell">
                            {s.guardian ? (
                              <span className="flex flex-col">
                                <span className="text-ink">{s.guardian.name}</span>
                                <span className="tabular inline-flex items-center gap-1 text-caption text-ink-muted">
                                  <Phone aria-hidden className="size-3" />
                                  {s.guardian.phone ?? '—'}
                                </span>
                              </span>
                            ) : (
                              <span className="text-ink-muted">—</span>
                            )}
                          </td>
                          <td className="px-6 py-3.5 text-right">
                            <span className="inline-flex items-center gap-2">
                              <Pill tone={STATUS_TONE[s.status] ?? 'neutral'}>
                                {t.statuses[s.status] ?? s.status}
                              </Pill>
                              <ChevronRight
                                aria-hidden
                                className="size-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5"
                              />
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between border-t border-line/60 px-6 py-3 text-caption text-ink-muted">
                  <span>{t.showing(shown.length, matching.length)}</span>
                  {matching.length > shown.length && (
                    <Button variant="secondary" onClick={() => setLimit((n) => n + PAGE)}>
                      {t.showMore}
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
