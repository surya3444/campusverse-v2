'use client';

// Home › My Work (rule book §12.2, §13 Workflow & Approvals): everything waiting for the signed-in
// person's decision, across processes and institutions, most urgent first; and what they decided
// lately. Each item opens in its own module, where it is decided.
import type { MyDecision, WorkItem } from '@campusverse/platform-workflow';
import {
  EmptyState,
  IconTile,
  KeyFigures,
  PageHeader,
  Pill,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  Toolbar,
  type Area,
} from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpenCheck,
  CalendarCheck,
  CalendarOff,
  ChevronRight,
  GraduationCap,
  HandCoins,
  Inbox,
  Megaphone,
  Receipt,
  RotateCcw,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { rupees, shortRupees } from '../../../lib/money';
import { chooseInstitution } from '../../../lib/scope';
import { en } from '../../../messages/en';
import { useUrlTab } from '../common/url-tab';

const t = en.workflow;
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);

/** Where each process is decided, and how it looks in the list. */
const KIND: Record<string, { href: (subjectId: string) => string; icon: LucideIcon; area: Area }> =
  {
    'expenses.bill': { href: (id) => `/expenses?bill=${id}`, icon: Receipt, area: 'amber' },
    'academics.registration': {
      href: () => '/course-registration',
      icon: BookOpenCheck,
      area: 'violet',
    },
    'payroll.settlement': { href: () => '/payroll?tab=settlements', icon: Wallet, area: 'teal' },
    'academics.results': { href: () => '/exam-results', icon: GraduationCap, area: 'violet' },
    'academics.reexam': { href: () => '/exam-results#reexams', icon: RotateCcw, area: 'violet' },
    'academics.condonation': {
      href: () => '/course-attendance#standing',
      icon: CalendarCheck,
      area: 'sky',
    },
    'staff.leave': { href: () => '/staff-leave', icon: CalendarOff, area: 'teal' },
    'finance.refund': { href: () => '/fees', icon: HandCoins, area: 'go' },
    'communications.notice': { href: (id) => `/notices/${id}`, icon: Megaphone, area: 'rose' },
  };
const kindOf = (process: string) =>
  KIND[process] ?? { href: () => '/', icon: Inbox, area: 'navy' as Area };

type Urgency = 'escalated' | 'overdue' | 'due' | 'waiting';
const urgency = (i: WorkItem, now: number): Urgency =>
  i.escalated
    ? 'escalated'
    : i.dueAt && new Date(i.dueAt).getTime() <= now
      ? 'overdue'
      : i.dueAt
        ? 'due'
        : 'waiting';
const RANK: Record<Urgency, number> = { escalated: 0, overdue: 1, due: 2, waiting: 3 };

export function MyWorkView() {
  const [tab, setTab] = useUrlTab<'waiting' | 'decided'>(['waiting', 'decided'], 'waiting');
  const work = useQuery({
    queryKey: ['my-work'],
    queryFn: () => api.get<WorkItem[]>('/workflow/my-work'),
  });
  const decided = useQuery({
    queryKey: ['my-decisions'],
    queryFn: () => api.get<MyDecision[]>('/workflow/my-decisions'),
    enabled: tab === 'decided',
  });
  const failed = work.error ?? decided.error;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Inbox}
        area="navy"
        eyebrow={en.nav.today}
        title={t.myWork}
        description={t.myWorkLead}
      >
        <Segmented
          label={t.myWork}
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'waiting',
              label: t.tabs.waiting,
              ...(work.data ? { count: work.data.length } : {}),
            },
            { value: 'decided', label: t.tabs.decided },
          ]}
        />
      </PageHeader>
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
          <StatePanel
            kind="error"
            title={en.states.error.title}
            body={t.errors.error ?? ''}
            action={en.states.error.action}
            onAction={() => void (tab === 'waiting' ? work.refetch() : decided.refetch())}
          />
        )
      ) : tab === 'waiting' ? (
        <Waiting items={work.data} />
      ) : (
        <Decided items={decided.data} />
      )}
    </div>
  );
}

function Waiting({ items }: { items: WorkItem[] | undefined }) {
  const router = useRouter();
  const [kind, setKind] = useState('all');
  const now = Date.now();
  const sorted = [...(items ?? [])].sort(
    (a, b) =>
      RANK[urgency(a, now)] - RANK[urgency(b, now)] || a.waitingSince.localeCompare(b.waitingSince),
  );
  const kinds = [...new Set(sorted.map((i) => i.process))];
  const shown = sorted.filter((i) => kind === 'all' || i.process === kind);
  const overdue = sorted.filter((i) => urgency(i, now) === 'overdue').length;
  const escalated = sorted.filter((i) => i.escalated).length;
  const amount = sorted.reduce((a, i) => a + (i.amountPaise ?? 0), 0);
  const open = (i: WorkItem) => {
    chooseInstitution(i.institutionId);
    router.push(kindOf(i.process).href(i.subjectId));
  };

  return (
    <>
      <KeyFigures
        variant="strip"
        label={t.figures}
        loading={!items}
        figures={[
          {
            label: t.fig.waiting,
            value: String(items?.length ?? '–'),
            note: t.fig.waitingNote,
            valueTone: 'navy',
          },
          {
            label: t.fig.overdue,
            value: String(items ? overdue : '–'),
            note: t.fig.overdueNote,
            ...(overdue ? { valueTone: 'stop' as const } : {}),
          },
          {
            label: t.fig.escalated,
            value: String(items ? escalated : '–'),
            note: t.fig.escalatedNote,
            ...(escalated ? { valueTone: 'stop' as const } : {}),
          },
          {
            label: t.fig.amount,
            value: items ? shortRupees(amount) : '–',
            note: t.fig.amountNote,
          },
        ]}
      />
      {!items ? (
        <Section flush>
          <div className="p-5">
            <SkeletonRows rows={4} label={en.states.loading.title} />
          </div>
        </Section>
      ) : items.length === 0 ? (
        <div className="panel">
          <EmptyState icon={Inbox} area="navy" title={t.emptyTitle} body={t.emptyBody} />
        </div>
      ) : (
        <Section flush>
          {kinds.length > 1 && (
            <div className="border-b border-line px-5 py-3">
              <Toolbar count={t.count(shown.length)}>
                <Segmented
                  label={t.kind}
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'all', label: t.all, count: sorted.length },
                    ...kinds.map((k) => ({
                      value: k,
                      label: t.processes[k] ?? k,
                      count: sorted.filter((i) => i.process === k).length,
                    })),
                  ]}
                />
              </Toolbar>
            </div>
          )}
          <ul className="divide-y divide-line" aria-label={t.tabs.waiting}>
            {shown.map((i) => {
              const k = kindOf(i.process);
              const u = urgency(i, now);
              const days = daysSince(i.waitingSince);
              return (
                <li key={i.requestId}>
                  <button
                    type="button"
                    onClick={() => open(i)}
                    className="group flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-paper focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-950 focus-visible:ring-inset"
                  >
                    <IconTile icon={k.icon} area={k.area} />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium break-words text-ink sm:truncate">
                          {i.summary}
                        </span>
                        {u === 'escalated' ? (
                          <Pill tone="stop">{t.escalated}</Pill>
                        ) : u === 'overdue' ? (
                          <Pill tone="warn">{t.overdue}</Pill>
                        ) : null}
                      </span>
                      <span className="text-caption text-ink-muted">
                        {[
                          t.processes[i.process] ?? i.process,
                          i.institution,
                          i.requestedBy ? t.requestedBy(i.requestedBy) : null,
                          i.steps > 1 ? t.stepOf(i.step, i.steps) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      <span className="tabular text-caption font-medium text-ink sm:hidden">
                        {[
                          i.amountPaise !== null ? rupees(i.amountPaise) : null,
                          u === 'due' && i.dueAt ? t.dueBy(when(i.dueAt)) : t.waitingFor(days),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
                      {i.amountPaise !== null && (
                        <span className="tabular text-body font-semibold text-ink">
                          {rupees(i.amountPaise)}
                        </span>
                      )}
                      <span
                        className={
                          u === 'overdue' || u === 'escalated'
                            ? 'text-caption font-medium text-signal-stop-ink'
                            : 'text-caption text-ink-muted'
                        }
                      >
                        {u === 'due' && i.dueAt ? t.dueBy(when(i.dueAt)) : t.waitingFor(days)}
                      </span>
                    </span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-body font-medium text-navy-950 shadow-[var(--shadow-card)] group-hover:bg-navy-50 sm:px-3">
                      <span className="sr-only sm:not-sr-only">{t.review}</span>
                      <ChevronRight aria-hidden className="size-4" />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </>
  );
}

function Decided({ items }: { items: MyDecision[] | undefined }) {
  const router = useRouter();
  if (!items)
    return (
      <Section flush>
        <div className="p-5">
          <SkeletonRows rows={4} label={en.states.loading.title} />
        </div>
      </Section>
    );
  if (items.length === 0)
    return (
      <div className="panel">
        <EmptyState
          icon={Inbox}
          area="navy"
          title={t.decidedEmptyTitle}
          body={t.decidedEmptyBody}
        />
      </div>
    );
  return (
    <Section flush title={t.tabs.decided} description={t.decidedLead}>
      <ul className="divide-y divide-line border-t border-line">
        {items.map((d) => {
          const k = kindOf(d.process);
          return (
            <li key={d.decisionId}>
              <button
                type="button"
                onClick={() => {
                  chooseInstitution(d.institutionId);
                  router.push(k.href(d.subjectId));
                }}
                className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-paper focus-visible:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-950 focus-visible:ring-inset"
              >
                <IconTile icon={k.icon} area={k.area} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-medium break-words text-ink sm:truncate">
                      {d.summary}
                    </span>
                    <Pill tone={d.decision === 'approve' ? 'go' : 'stop'}>
                      {t.decisions[d.decision]}
                    </Pill>
                  </span>
                  <span className="text-caption text-ink-muted">
                    {[
                      t.processes[d.process] ?? d.process,
                      d.institution,
                      d.steps > 1 ? t.stepOf(d.step, d.steps) : null,
                      t.now[d.status],
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {d.note && <span className="text-caption text-ink">“{d.note}”</span>}
                  <span className="tabular text-caption text-ink-muted sm:hidden">
                    {[d.amountPaise !== null ? rupees(d.amountPaise) : null, when(d.decidedAt)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
                  {d.amountPaise !== null && (
                    <span className="tabular text-body font-semibold text-ink">
                      {rupees(d.amountPaise)}
                    </span>
                  )}
                  <span className="text-caption text-ink-muted">{when(d.decidedAt)}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
