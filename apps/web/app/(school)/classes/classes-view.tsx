'use client';

import type { ClassesOverview } from '@campusverse/school-setup';
import {
  EmptyState,
  KeyFigures,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, School } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { useMe } from '../common/me';
import { field } from '../exams/shared';
import { formatDate } from '../setup/shared';

const t = en.classesPage;

/** Every year's classes and sections: who teaches each, how many students, how many seats. */
export function ClassesView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  const view = useQuery({
    queryKey: ['classes', id],
    queryFn: () => api.get<ClassesOverview>(`/school/setup/${id}/classes`),
    enabled: !!id,
  });
  const years = view.data?.years ?? [];
  const [chosen, setChosen] = useState('');
  const year =
    years.find((y) => y.yearId === chosen) ?? years.find((y) => y.status === 'active') ?? years[0];
  const sections = year?.classes.flatMap((c) => c.sections) ?? [];
  const students = sections.reduce((n, s) => n + s.students, 0);
  const seats = sections.reduce((n, s) => n + s.capacity, 0);
  // The student list shows where each student is today, so links go there only for the running year.
  const current = !!year && year.countedOn > year.starts && year.countedOn < year.ends;
  const failed = view.error ?? school.error;
  const cards = can('school.certificate.request');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={School}
        area="violet"
        eyebrow={en.nav.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          years.length > 1 && year ? (
            <label className="flex items-center gap-2 text-caption font-medium text-ink">
              {t.year}
              <select
                value={year.yearId}
                onChange={(e) => setChosen(e.target.value)}
                className={field}
              >
                {years.map((y) => (
                  <option key={y.yearId} value={y.yearId}>
                    {y.label} · {t.status[y.status]}
                  </option>
                ))}
              </select>
            </label>
          ) : year ? (
            <Pill>{year.label}</Pill>
          ) : undefined
        }
      />
      {failed ? (
        failed instanceof ApiFailure && failed.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : typeof navigator !== 'undefined' && !navigator.onLine ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} body={en.states.error.body} />
        )
      ) : !id || view.isPending ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : !year || year.classes.length === 0 ? (
        <Section>
          <EmptyState
            art="setup"
            title={t.empty}
            body={t.emptyBody}
            actions={
              <Link
                href="/setup"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-900"
              >
                {en.nav.setup}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
            }
          />
        </Section>
      ) : (
        <>
          <KeyFigures
            variant="strip"
            label={t.title}
            figures={[
              { label: t.figures.classes, value: String(year.classes.length) },
              { label: t.figures.sections, value: String(sections.length) },
              { label: t.figures.students, value: String(students) },
              { label: t.figures.seatsFree, value: String(Math.max(0, seats - students)) },
            ]}
          />
          <p className="text-caption text-ink-muted">{t.countedOn(formatDate(year.countedOn))}</p>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {year.classes.map((c) => (
              <Section key={c.classId} title={c.name} flush>
                <div role="region" aria-label={c.name} tabIndex={0} className="overflow-x-auto">
                  <table className="w-full text-body">
                    <caption className="sr-only">{c.name}</caption>
                    <thead>
                      <tr className="border-b border-line text-left text-caption text-ink-muted">
                        <th scope="col" className="px-5 py-2.5 font-medium">
                          {t.section}
                        </th>
                        <th scope="col" className="px-3 py-2.5 font-medium">
                          {t.classTeacher}
                        </th>
                        <th scope="col" className="px-3 py-2.5 text-right font-medium">
                          {t.students}
                        </th>
                        {current && (
                          <th scope="col" className="px-5 py-2.5">
                            <span className="sr-only">{t.open}</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {c.sections.map((s) => (
                        <tr key={s.sectionId}>
                          <th scope="row" className="px-5 py-3 text-left font-medium text-ink">
                            {s.name}
                          </th>
                          <td className="px-3 py-3 text-ink">
                            {s.classTeacher ?? (
                              <span className="text-ink-muted">{t.noClassTeacher}</span>
                            )}
                          </td>
                          <td className="tabular px-3 py-3 text-right text-ink">
                            {t.ofCapacity(s.students, s.capacity)}
                          </td>
                          {current && (
                            <td className="px-5 py-3 text-right">
                              {cards && (
                                <a
                                  href={`/api/v1/school/certificates/id-cards?sectionId=${s.sectionId}`}
                                  target="_blank"
                                  rel="noopener"
                                  aria-label={t.idCardsFor(s.label)}
                                  className="mr-3 inline-flex items-center gap-1 font-medium text-navy-950 underline-offset-2 hover:underline"
                                >
                                  {t.idCards}
                                </a>
                              )}
                              <Link
                                href={`/students?class=${encodeURIComponent(s.label)}`}
                                aria-label={t.openSection(s.label)}
                                className="inline-flex items-center gap-1 font-medium text-navy-950 underline-offset-2 hover:underline"
                              >
                                {t.open}
                                <ArrowRight aria-hidden className="size-3.5" />
                              </Link>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
