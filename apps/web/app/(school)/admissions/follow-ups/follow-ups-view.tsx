'use client';

import type { FollowUpItem } from '@campusverse/school-admissions';
import {
  Button,
  EmptyState,
  KeyFigures,
  PageHeader,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, Check, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { useMe } from '../../common/me';
import { useUrlTab } from '../../common/url-tab';
import { CompleteFollowUpDialog } from '../activity';
import {
  ContactActions,
  Interest,
  StagePill,
  admissionError,
  c,
  daysTo,
  shortDate,
  when,
} from '../shared';

type Group = 'overdue' | 'today' | 'upcoming' | 'done';
const GROUP_TONE: Record<Group, string> = {
  overdue: 'text-signal-stop-ink',
  today: 'text-navy-950',
  upcoming: 'text-ink',
  done: 'text-ink-muted',
};

/** What to do for which family, and when: overdue first, then today, then the days ahead. */
export function FollowUpsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const me = useMe();
  const [who, setWho] = useUrlTab(['mine', 'everyone'] as const, 'mine');
  const [done, setDone] = useState<FollowUpItem | null>(null);
  const list = useQuery({
    queryKey: ['admission-follow-ups', id],
    queryFn: () => api.get<FollowUpItem[]>(`/school/admissions/${id}/follow-ups`),
    enabled: !!id,
  });
  if (list.isError)
    return list.error instanceof ApiFailure && list.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={admissionError(list.error)} />
    );
  const mine = (f: FollowUpItem) => f.assignedTo.personId === me.data?.personId;
  const rows = (list.data ?? []).filter((f) => who === 'everyone' || mine(f));
  const group = (f: FollowUpItem): Group =>
    f.doneAt
      ? 'done'
      : daysTo(f.dueOn) < 0
        ? 'overdue'
        : daysTo(f.dueOn) === 0
          ? 'today'
          : 'upcoming';
  const by = (g: Group) => rows.filter((f) => group(f) === g);
  const open = rows.filter((f) => !f.doneAt);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarCheck2}
        eyebrow={en.systems.groups.enrollment}
        title={c.followUps.title}
        description={c.followUps.lead}
      >
        <Segmented
          label={c.followUps.whose}
          value={who}
          onChange={setWho}
          options={[
            {
              value: 'mine',
              label: c.followUps.mine,
              count: (list.data ?? []).filter((f) => !f.doneAt && mine(f)).length,
            },
            {
              value: 'everyone',
              label: c.followUps.everyone,
              count: (list.data ?? []).filter((f) => !f.doneAt).length,
            },
          ]}
        />
      </PageHeader>

      <KeyFigures
        variant="strip"
        label={c.followUps.title}
        loading={list.isPending}
        figures={[
          {
            label: c.followUps.groups.overdue,
            value: String(by('overdue').length),
            ...(by('overdue').length ? { valueTone: 'stop' as const } : {}),
          },
          { label: c.followUps.groups.today, value: String(by('today').length), valueTone: 'navy' },
          {
            label: c.followUps.thisWeek,
            value: String(open.filter((f) => daysTo(f.dueOn) >= 0 && daysTo(f.dueOn) <= 7).length),
          },
          { label: c.followUps.doneRecently, value: String(by('done').length), tone: 'go' },
        ]}
      />

      {list.isPending ? (
        <div className="panel">
          <SkeletonRows rows={5} label={en.states.loading.title} />
        </div>
      ) : rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            art="timetable"
            title={who === 'mine' ? c.followUps.noneMine : c.followUps.none}
            body={c.followUps.noneBody}
            actions={
              <Link
                href="/admissions/leads"
                className="inline-flex h-10 items-center rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-950/90"
              >
                {c.leads.title}
              </Link>
            }
          />
        </div>
      ) : (
        (['overdue', 'today', 'upcoming', 'done'] as const).map((g) => {
          const items = by(g);
          if (items.length === 0) return null;
          return (
            <section key={g} aria-labelledby={`fu-${g}`} className="panel overflow-hidden">
              <h2
                id={`fu-${g}`}
                className={cx(
                  'flex items-center gap-2 border-b border-line px-5 py-3.5 font-display text-body font-semibold',
                  GROUP_TONE[g],
                )}
              >
                {c.followUps.groups[g]}
                <span className="tabular rounded-full bg-navy-50 px-2 py-0.5 text-caption font-medium text-ink-muted">
                  {items.length}
                </span>
              </h2>
              <ul className="divide-y divide-line">
                {items.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                    <DateTile iso={f.doneAt ? f.doneAt.slice(0, 10) : f.dueOn} tone={g} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Link
                          href={`/admissions/${f.applicationId}`}
                          className="font-medium text-ink hover:text-navy-950 hover:underline"
                        >
                          {f.childName}
                        </Link>
                        <span className="text-caption text-ink-muted">{f.className}</span>
                        <StagePill state={f.state} />
                        <Interest value={f.interest} />
                      </span>
                      <span
                        className={cx(
                          'text-body',
                          f.doneAt ? 'text-ink-muted line-through' : 'text-ink',
                        )}
                      >
                        {f.purpose}
                      </span>
                      <span className="text-caption text-ink-muted">
                        {f.doneAt
                          ? c.followUps.doneBy(f.outcome ?? '', when(f.doneAt))
                          : c.followUps.forWhom(f.guardianName, f.assignedTo.name)}
                      </span>
                    </div>
                    {!f.doneAt && (
                      <span className="flex items-center gap-2">
                        <ContactActions phone={f.guardianPhone} name={f.guardianName} />
                        <Button
                          size="sm"
                          onClick={() => setDone(f)}
                          aria-label={c.followUps.markDoneFor(f.childName)}
                        >
                          <Check aria-hidden className="size-4" />
                          {c.followUps.markDone}
                        </Button>
                      </span>
                    )}
                    {f.doneAt && <CheckCircle2 aria-hidden className="size-5 text-signal-go" />}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {done && (
        <CompleteFollowUpDialog
          followUpId={done.id}
          childName={done.childName}
          purpose={done.purpose}
          onClose={() => setDone(null)}
        />
      )}
    </div>
  );
}

function DateTile({ iso, tone }: { iso: string; tone: Group }) {
  const [day, month] = shortDate(iso).split(' ');
  return (
    <span
      aria-hidden
      className={cx(
        'flex size-12 shrink-0 flex-col items-center justify-center rounded-xl border',
        tone === 'overdue'
          ? 'border-signal-stop/30 bg-signal-stop-tint text-signal-stop-ink'
          : tone === 'today'
            ? 'border-navy-950 bg-navy-950 text-white'
            : 'border-line bg-paper text-ink',
      )}
    >
      <span className="tabular text-lead leading-none font-bold">{day}</span>
      <span className="text-[10px] font-semibold tracking-wide uppercase">{month}</span>
    </span>
  );
}
