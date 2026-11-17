'use client';

// Home › My Work (rule book §12.2, §13 Workflow & Approvals): everything waiting for the signed-in
// person's decision, across processes and institutions. Each item opens in its own module.
import type { WorkItem } from '@campusverse/platform-workflow';
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
import { AlarmClock, ArrowUpRight, Inbox, Siren } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ApiFailure, api } from '../../../lib/api';
import { rupees } from '../../../lib/money';
import { chooseInstitution } from '../../../lib/scope';
import { en } from '../../../messages/en';

const t = en.workflow;
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));

/** Where each process is decided. */
const HREF: Record<string, (subjectId: string) => string> = {
  'expenses.bill': (id) => `/expenses?bill=${id}`,
  'academics.registration': () => '/course-registration',
  'payroll.settlement': () => '/payroll?tab=settlements',
  'academics.results': () => '/exam-results',
  'academics.reexam': () => '/exam-results#reexams',
  'academics.condonation': () => '/course-attendance#standing',
  'staff.leave': () => '/staff-leave',
  'finance.refund': () => '/fees',
  'communications.notice': (id) => `/notices/${id}`,
};

export function MyWorkView() {
  const router = useRouter();
  const q = useQuery({
    queryKey: ['my-work'],
    queryFn: () => api.get<WorkItem[]>('/workflow/my-work'),
  });
  const items = q.data;
  const now = Date.now();
  const overdue = items?.filter((i) => i.dueAt && new Date(i.dueAt).getTime() <= now) ?? [];
  const open = (i: WorkItem) => {
    chooseInstitution(i.institutionId);
    router.push(HREF[i.process]?.(i.subjectId) ?? '/');
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Inbox}
        area="navy"
        eyebrow={en.nav.today}
        title={t.myWork}
        description={t.myWorkLead}
      />
      {q.error ? (
        q.error instanceof ApiFailure && q.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} />
        ) : typeof navigator !== 'undefined' && !navigator.onLine ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={t.errors.error ?? ''} />
        )
      ) : (
        <>
          <KeyFigures
            label={t.figures}
            loading={!items}
            figures={[
              { label: t.fig.waiting, icon: Inbox, value: String(items?.length ?? '–') },
              {
                label: t.fig.overdue,
                icon: AlarmClock,
                value: String(items ? overdue.length : '–'),
                ...(overdue.length ? { tone: 'warn' as const } : {}),
              },
              {
                label: t.fig.escalated,
                icon: Siren,
                value: String(items?.filter((i) => i.escalated).length ?? '–'),
              },
            ]}
          />
          {!items ? (
            <SkeletonRows rows={5} label={en.states.loading.title} />
          ) : items.length === 0 ? (
            <Section>
              <EmptyState icon={Inbox} area="navy" title={t.emptyTitle} body={t.emptyBody} />
            </Section>
          ) : (
            <Section flush>
              <ul className="divide-y divide-line" aria-label={t.myWork}>
                {items.map((i) => {
                  const what = t.processes[i.process] ?? i.process;
                  const late = !!i.dueAt && new Date(i.dueAt).getTime() <= now;
                  return (
                    <li key={i.requestId}>
                      <button
                        type="button"
                        onClick={() => open(i)}
                        className="group flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4 text-left hover:bg-paper focus-visible:bg-paper"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <Pill>{what}</Pill>
                            {i.steps > 1 && (
                              <span className="text-caption text-ink-muted">
                                {t.stepOf(i.step, i.steps)}
                              </span>
                            )}
                            {i.escalated ? (
                              <Pill tone="stop">{t.escalated}</Pill>
                            ) : late ? (
                              <Pill tone="warn">{t.overdue}</Pill>
                            ) : null}
                          </span>
                          <span className="mt-1 block truncate font-medium text-ink">
                            {i.summary}
                          </span>
                          <span className="block text-caption text-ink-muted">
                            {i.institution}
                            {i.requestedBy ? ` · ${t.requestedBy(i.requestedBy)}` : ''} ·{' '}
                            {t.waitingSince(when(i.waitingSince))}
                            {i.dueAt && !late ? ` · ${t.dueBy(when(i.dueAt))}` : ''}
                          </span>
                        </span>
                        {i.amountPaise !== null && (
                          <span className="tabular font-display text-lead font-semibold text-ink">
                            {rupees(i.amountPaise)}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 text-body font-medium text-navy-950">
                          {t.open}
                          <ArrowUpRight aria-hidden className="size-4" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
