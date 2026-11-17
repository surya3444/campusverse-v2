'use client';

import type { ClassesOverview } from '@campusverse/school-setup';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, Lock, LockOpen } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { formatDate } from '../setup/shared';

const t = en.yearsPage;
type Year = ClassesOverview['years'][number];
const TONE: Record<Year['status'], Tone> = {
  planned: 'neutral',
  active: 'go',
  ended: 'warn',
  closed: 'neutral',
};
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
/** The last day of a year whose `ends` is exclusive. */
const lastDay = (ends: string) =>
  new Date(Date.parse(`${ends}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

/** Every academic year, its place in the year's life (set up, running, ended, closed) and its actions. */
export function YearsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  const manage = can('school.setup.manage');
  const qc = useQueryClient();
  const view = useQuery({
    queryKey: ['classes', id],
    queryFn: () => api.get<ClassesOverview>(`/school/setup/${id}/classes`),
    enabled: !!id,
  });
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [closing, setClosing] = useState<Year | null>(null);
  const [reopening, setReopening] = useState<Year | null>(null);
  const refresh = () => {
    setError('');
    void qc.invalidateQueries({ queryKey: ['classes', id] });
    void qc.invalidateQueries({ queryKey: ['exam-years', id] });
  };
  const nextYear = useMutation({
    mutationFn: () =>
      api.post<{ label: string; sections: number }>(`/school/setup/${id}/next-year`, {}),
    onSuccess: (r) => {
      setNotice(en.yearEnd.nextYearReady(r.label, r.sections));
      refresh();
    },
    onError: (e) => setError(errorText(e)),
  });
  const years = view.data?.years ?? [];
  const hasNext = years.some((y) => y.status === 'planned');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarDays}
        area="violet"
        eyebrow={en.nav.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          manage && years.length > 0 && !hasNext ? (
            <Button disabled={nextYear.isPending} onClick={() => nextYear.mutate()}>
              {en.yearEnd.setUpNextYear}
            </Button>
          ) : undefined
        }
      />
      <ol aria-label={t.lifecycle} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {t.steps.map((s, i) => (
          <li key={s.title} className="panel flex gap-3 p-4">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-navy-950 text-caption font-semibold text-white"
            >
              {i + 1}
            </span>
            <span className="flex flex-col">
              <span className="text-body font-semibold text-ink">{s.title}</span>
              <span className="text-caption text-ink-muted">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-signal-stop-tint px-4 py-3 text-body text-signal-stop-ink"
        >
          {error}
        </p>
      )}
      {view.isError || school.isError ? (
        (view.error ?? school.error) instanceof ApiFailure &&
        (view.error as ApiFailure).status === 403 ? (
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
        <SkeletonRows rows={4} label={en.states.loading.title} />
      ) : years.length === 0 ? (
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
        <Section title={t.listTitle} flush>
          <ul aria-label={t.listTitle} className="divide-y divide-line">
            {years.map((y) => {
              const sections = y.classes.flatMap((c) => c.sections);
              const students = sections.reduce((n, s) => n + s.students, 0);
              return (
                <li
                  key={y.yearId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
                >
                  <span className="flex min-w-48 flex-1 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="font-display text-lead font-semibold text-ink">
                        {y.label}
                      </span>
                      <Pill tone={TONE[y.status]}>{en.classesPage.status[y.status]}</Pill>
                    </span>
                    <span className="text-caption text-ink-muted">
                      {t.dates(formatDate(y.starts), formatDate(lastDay(y.ends)))}
                    </span>
                  </span>
                  <span className="tabular text-caption text-ink-muted">
                    {t.counts(y.classes.length, sections.length, students)}
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href="/classes"
                      className="inline-flex h-9 items-center rounded-lg px-3 text-body font-medium text-navy-950 hover:bg-navy-50"
                    >
                      {t.viewClasses}
                    </Link>
                    {y.status === 'ended' && (
                      <Link
                        href="/year-end"
                        className="inline-flex h-9 items-center rounded-lg px-3 text-body font-medium text-navy-950 hover:bg-navy-50"
                      >
                        {en.nav.yearEnd}
                      </Link>
                    )}
                    {manage && y.status === 'ended' && (
                      <Button size="sm" variant="secondary" onClick={() => setClosing(y)}>
                        <Lock aria-hidden className="size-3.5" />
                        {t.close}
                      </Button>
                    )}
                    {manage && y.status === 'closed' && (
                      <Button size="sm" variant="quiet" onClick={() => setReopening(y)}>
                        <LockOpen aria-hidden className="size-3.5" />
                        {t.reopen}
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {closing && id && (
        <CloseYear
          institutionId={id}
          year={closing}
          onClose={() => setClosing(null)}
          onDone={() => {
            setNotice(t.closed(closing.label));
            setClosing(null);
            refresh();
          }}
        />
      )}
      {reopening && id && (
        <ReopenYear
          institutionId={id}
          year={reopening}
          onClose={() => setReopening(null)}
          onDone={() => {
            setNotice(t.reopened(reopening.label));
            setReopening(null);
            refresh();
          }}
        />
      )}
      <Announcer message={notice} />
    </div>
  );
}

function CloseYear({
  institutionId,
  year,
  onClose,
  onDone,
}: {
  institutionId: string;
  year: Year;
  onClose: () => void;
  onDone: () => void;
}) {
  const close = useMutation({
    mutationFn: () => api.post(`/school/setup/${institutionId}/years/${year.yearId}/close`, {}),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.closeTitle(year.label)}
      description={t.closeBody}
      submitLabel={t.close}
      cancelLabel={t.cancel}
      pending={close.isPending}
      error={close.isError ? errorText(close.error) : null}
      onClose={onClose}
      onSubmit={() => close.mutate()}
    >
      <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink sm:col-span-2">
        {t.locks.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </FormModal>
  );
}

function ReopenYear({
  institutionId,
  year,
  onClose,
  onDone,
}: {
  institutionId: string;
  year: Year;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const reopen = useMutation({
    mutationFn: () =>
      api.post(`/school/setup/${institutionId}/years/${year.yearId}/reopen`, { reason }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.reopenTitle(year.label)}
      description={t.reopenBody}
      submitLabel={t.reopen}
      cancelLabel={t.cancel}
      pending={reopen.isPending}
      error={reopen.isError ? errorText(reopen.error) : null}
      onClose={onClose}
      onSubmit={() => reopen.mutate()}
    >
      <ModalField label={t.reason} wide>
        <input
          required
          minLength={5}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
