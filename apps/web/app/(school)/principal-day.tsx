'use client';

import {
  AttentionList,
  DayLine,
  KeyFigures,
  OfflineBanner,
  RecordDrawer,
  StatePanel,
  useNowInIndia,
  type AttentionItem,
  type ViewState,
} from '@campusverse/ui';
import { useState } from 'react';
import { en } from '../../messages/en';
import { useSchoolActions } from './shell';
import { blocks, coverPeriods, markers, today, unmarkedSections } from './synthetic';

const dateInIndia = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const num = new Intl.NumberFormat('en-IN');

const LANES = (Object.entries(en.dayLine.lanes) as [string, string][]).map(([id, label]) => ({
  id,
  label,
}));

/** The principal's home: key figures, the day's schedule, and what needs them now. */
export function PrincipalDay({ state, at }: { state: ViewState; at?: string }) {
  const now = useNowInIndia(at);
  const { openRemind, announce } = useSchoolActions();
  const [coverOpen, setCoverOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const effective: ViewState = state === 'error' && attempt > 0 ? 'ready' : state;
  const loading = effective === 'loading';
  const empty = effective === 'empty';

  const attention: AttentionItem[] = [
    {
      id: 'unmarked',
      tone: 'stop',
      title: en.attention.unmarked(unmarkedSections.length),
      detail: en.attention.unmarkedDetail(
        unmarkedSections.map((u) => u.section),
        '09:30',
      ),
      at: '09:30',
      action: { label: en.remind.action(unmarkedSections.length), onSelect: openRemind },
    },
    {
      id: 'cover',
      tone: 'warn',
      title: en.attention.cover(2, coverPeriods.length),
      detail: en.attention.coverDetail(['Science', 'Mathematics'], '13:10'),
      at: '09:45',
      action: { label: en.cover.action, onSelect: () => setCoverOpen(true) },
    },
    {
      id: 'leave',
      tone: 'neutral',
      title: en.attention.leave(today.leaveRequests),
      detail: en.attention.leaveDetail(2, 1),
      at: '11:00',
      action: { label: en.leave.action, onSelect: () => announce(en.leave.note) },
    },
  ];

  const h = en.home;
  const figures = [
    {
      label: h.attendance,
      value: `${((today.marked / today.sections) * 100).toFixed(0)}%`,
      note: h.attendanceNote(today.sections - today.marked),
      tone: 'warn' as const,
    },
    {
      label: h.present,
      value: num.format(today.present),
      note: h.presentNote(num.format(today.enrolled)),
    },
    {
      label: h.collected,
      value: inr.format(today.collected),
      note: h.collectedNote(today.dueFamilies),
    },
    { label: h.approvals, value: String(today.leaveRequests), note: h.approvalsNote },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-0.5">
        <p className="text-caption text-ink-muted">{dateInIndia.format(new Date())}</p>
        <h1 className="text-title font-semibold text-ink">{h.title}</h1>
      </div>

      {effective === 'denied' ? (
        <StatePanel kind="denied" title={h.deniedTitle} body={h.deniedBody} />
      ) : effective === 'error' ? (
        <StatePanel
          kind="error"
          title={h.errorTitle}
          body={h.errorBody}
          action={h.retry}
          onAction={() => setAttempt((a) => a + 1)}
        />
      ) : (
        <>
          {effective === 'offline' && <OfflineBanner>{h.offline('09:38')}</OfflineBanner>}
          <KeyFigures variant="strip" figures={figures} label={h.figures} loading={loading} />
          <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <DayLine
              loading={loading}
              now={now}
              end="17:00"
              lanes={LANES}
              blocks={empty ? [] : blocks}
              markers={empty ? [] : markers}
              labels={en.dayLine}
            />
            <AttentionList
              items={empty ? [] : attention}
              loading={loading}
              labels={en.attentionList}
            />
          </div>
        </>
      )}

      <RecordDrawer
        open={coverOpen}
        onOpenChange={setCoverOpen}
        title={en.cover.title}
        subtitle={en.cover.subtitle}
        closeLabel={en.drawer.close}
      >
        <ul className="flex flex-col divide-y divide-line">
          {coverPeriods.map((p) => (
            <li key={p.period} className="py-3">
              <p className="tabular font-medium text-ink">{p.period}</p>
              <p className="text-caption text-ink-muted">
                {p.section} · {p.subject}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-caption text-ink-muted">{en.cover.note}</p>
      </RecordDrawer>
    </div>
  );
}
