'use client';

import type { MarkingSheet, SheetStudent } from '@campusverse/school-attendance';
import { Announcer, Button, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { deviceId, enqueue, flush, useSyncQueue, uuidv7 } from '../../../../lib/sync-queue';
import { en } from '../../../../messages/en';
import { ReasonDialog } from '../../reason-dialog';
import { PendingBanner } from '../pending-banner';
import { STATUS_TILE, clock, errorText, shortDate, t } from '../shared';

const MARKABLE = ['present', 'absent', 'late', 'half_day', 'school_duty'] as const;
const CORRECTABLE = [...MARKABLE, 'approved_leave', 'medical_leave'] as const;

export function MarkView({ sectionId, date }: { sectionId: string; date: string | null }) {
  const key = ['attendance-sheet', sectionId, date];
  const sheet = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<MarkingSheet>(
        `/school/attendance/sections/${sectionId}${date ? `?date=${date}` : ''}`,
      ),
  });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ personId: string }>('/people/me'),
  });
  // When queued submissions go out after reconnecting, show the day as the server now has it.
  const { count } = useSyncQueue();
  const before = useRef(count);
  const { refetch } = sheet;
  useEffect(() => {
    if (count < before.current) void refetch();
    before.current = count;
  }, [count, refetch]);

  if (sheet.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (sheet.isError) {
    const denied = sheet.error instanceof ApiFailure && sheet.error.status === 403;
    return denied ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={errorText(sheet.error)}
        action={en.states.error.action}
        onAction={() => void sheet.refetch()}
      />
    );
  }
  const s = sheet.data;
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/attendance"
        className="inline-flex items-center gap-1.5 self-start text-body text-navy-950 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-semibold text-ink">{s.label}</h1>
          <p className="text-body text-ink-muted">{shortDate(s.onDate)}</p>
        </div>
        <Link
          href={`/attendance/${s.sectionId}/register`}
          className="inline-flex h-9 items-center rounded-md border border-line-strong px-3.5 text-body text-ink hover:bg-paper"
        >
          {t.register}
        </Link>
      </div>
      <PendingBanner />
      {s.holiday ? (
        <StatePanel kind="empty" title={t.holidayNoMark(s.holiday)} />
      ) : s.session ? (
        <TakenDay sheet={s} queryKey={key} />
      ) : !s.canMark ? (
        <StatePanel kind="empty" title={t.readOnly} />
      ) : s.onDate > s.today ? (
        <StatePanel kind="empty" title={t.future} />
      ) : s.students.length === 0 ? (
        <StatePanel kind="empty" title={t.errors.empty_roster ?? ''} />
      ) : (
        <Roster sheet={s} actorId={me.data?.personId ?? null} queryKey={key} />
      )}
    </div>
  );
}

/** The roster fills the screen: everyone present, tap absentees, submit. */
function Roster({
  sheet,
  actorId,
  queryKey,
}: {
  sheet: MarkingSheet;
  actorId: string | null;
  queryKey: unknown[];
}) {
  const qc = useQueryClient();
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'go' | 'warn' | 'stop'; text: string } | null>(
    null,
  );
  const statusOf = (st: SheetStudent) => marks[st.personId] ?? st.onLeave ?? 'present';
  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    for (const st of sheet.students) {
      if (st.markedIn) continue;
      const v = marks[st.personId] ?? st.onLeave ?? 'present';
      if (v === 'present') present++;
      else if (v === 'absent') absent++;
    }
    const here = sheet.students.filter((st) => !st.markedIn).length;
    return { present, absent, other: here - present - absent };
  }, [marks, sheet.students]);

  const set = (st: SheetStudent, status: string) =>
    setMarks((m) => {
      // Only differences from the default (present, or approved leave) are kept and sent.
      const rest = Object.fromEntries(Object.entries(m).filter(([id]) => id !== st.personId));
      return status === (st.onLeave ?? 'present') ? rest : { ...rest, [st.personId]: status };
    });

  const submit = async () => {
    if (!actorId) return;
    setBusy(true);
    setOutcome(null);
    const eventId = uuidv7();
    const label = `${sheet.label}, ${shortDate(sheet.onDate)}`;
    // Stored first: if the network drops now, the submission waits on this device.
    await enqueue({
      eventId,
      deviceId: deviceId(),
      actorId,
      occurredAt: new Date().toISOString(),
      type: 'attendance.mark',
      payload: {
        sectionId: sheet.sectionId,
        onDate: sheet.onDate,
        marks: Object.entries(marks)
          .filter(([, v]) => (MARKABLE as readonly string[]).includes(v))
          .map(([personId, status]) => ({ personId, status })),
      },
      label,
    });
    const answer = (await flush()).find((r) => r.eventId === eventId);
    setBusy(false);
    if (!answer) {
      setOutcome({ tone: 'warn', text: t.savedOffline(label) });
      return;
    }
    if (answer.outcome === 'rejected') {
      setOutcome({
        tone: 'stop',
        text: t.rejected(label, t.errors[answer.code ?? 'error'] ?? answer.code ?? ''),
      });
    } else if (answer.outcome === 'conflict') {
      setOutcome({ tone: 'warn', text: t.conflictSent(label, answer.conflicts ?? 0) });
    }
    if (answer.outcome !== 'rejected') {
      setMarks({});
      await qc.invalidateQueries({ queryKey });
      await qc.invalidateQueries({ queryKey: ['attendance-day'] });
    }
  };

  return (
    <section aria-label={t.mark} className="flex flex-col gap-4">
      <p className="text-body text-ink-muted">{t.tapHint}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sheet.students.map((st) => {
          // Moved here today after the old section's register was taken: that mark stands.
          if (st.markedIn)
            return (
              <li
                key={st.personId}
                className="flex min-h-14 items-center gap-3 rounded-lg border border-dashed border-line-strong bg-paper px-4"
              >
                <span className="tabular w-6 shrink-0 text-caption text-ink-muted">
                  {st.rollNumber ?? ''}
                </span>
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                  {st.name}
                </span>
                <span className="shrink-0 text-caption text-ink-muted">
                  {t.markedIn(st.markedIn)}
                </span>
              </li>
            );
          const status = statusOf(st);
          const absent = status === 'absent';
          return (
            <li
              key={st.personId}
              className={cx(
                'flex items-stretch overflow-hidden rounded-lg border',
                STATUS_TILE[status],
              )}
            >
              <button
                type="button"
                aria-pressed={absent}
                onClick={() => set(st, absent ? (st.onLeave ?? 'present') : 'absent')}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-navy-950 focus-visible:ring-inset"
              >
                <span className="tabular w-6 shrink-0 text-caption text-ink-muted">
                  {st.rollNumber ?? ''}
                </span>
                <span className="min-w-0 flex-1 truncate text-body font-medium">{st.name}</span>
                <span className="shrink-0 text-caption font-medium">{t.statuses[status]}</span>
              </button>
              {/* Late, half day and school duty: a native menu behind a "more" icon. */}
              <span className="relative flex w-11 shrink-0 border-l border-line">
                <MoreHorizontal
                  aria-hidden
                  className="pointer-events-none absolute inset-0 m-auto size-4 text-ink-muted"
                />
                <select
                  aria-label={t.more(st.name)}
                  value={(MARKABLE as readonly string[]).includes(status) ? status : ''}
                  onChange={(e) => set(st, e.target.value)}
                  className="w-full cursor-pointer appearance-none bg-transparent text-transparent outline-none focus-visible:ring-2 focus-visible:ring-navy-950 focus-visible:ring-inset"
                >
                  {!(MARKABLE as readonly string[]).includes(status) && (
                    <option value="" className="text-ink">
                      {t.statuses[status]}
                    </option>
                  )}
                  {MARKABLE.map((m) => (
                    <option key={m} value={m} className="text-ink">
                      {t.statuses[m]}
                    </option>
                  ))}
                </select>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-surface px-4 py-3 sm:static sm:mx-0 sm:rounded-lg sm:border sm:px-5">
        <span className="tabular flex-1 text-body text-ink">
          {t.counts(counts.present, counts.absent, counts.other)}
        </span>
        <Button size="lg" disabled={busy || !actorId} onClick={() => void submit()}>
          {busy ? t.submitting : t.submit(counts.absent)}
        </Button>
      </div>
      {outcome && (
        <p
          role="alert"
          className={cx(
            'rounded-md px-4 py-3 text-body',
            outcome.tone === 'stop' && 'bg-signal-stop-tint text-signal-stop-ink',
            outcome.tone === 'warn' && 'bg-signal-warn-tint text-signal-warn-ink',
            outcome.tone === 'go' && 'bg-signal-go-tint text-signal-go-ink',
          )}
        >
          {outcome.text}
        </p>
      )}
    </section>
  );
}

/** A day already taken: statuses, sign-off, and corrections with a reason. */
function TakenDay({ sheet, queryKey }: { sheet: MarkingSheet; queryKey: unknown[] }) {
  const qc = useQueryClient();
  const [correcting, setCorrecting] = useState<SheetStudent | null>(null);
  const [status, setStatus] = useState('present');
  const [message, setMessage] = useState<string | null>(null);
  const session = sheet.session;
  const signOff = useMutation({
    mutationFn: () =>
      api.post('/school/attendance/sign-off', { sectionId: sheet.sectionId, onDate: sheet.onDate }),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  });
  if (!session) return null;
  const absent = sheet.students.filter((s) => s.status === 'absent').length;
  const present = sheet.students.filter((s) => s.status === 'present').length;

  return (
    <section aria-label={t.states.submitted} className="flex flex-col gap-4">
      <div className="panel flex flex-wrap items-center gap-3 px-5 py-4">
        <CheckCircle2 aria-hidden className="size-5 shrink-0 text-signal-go" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-body font-medium text-ink">
            {t.done(sheet.label, present, absent)}
          </span>
          <span className="text-caption text-ink-muted">
            {t.submitted(clock(session.submittedAt), session.submittedBy)}
            {session.signedOffAt
              ? ` · ${t.signedOff}`
              : session.signOffRequired
                ? ` · ${t.awaitingSignOff}`
                : ''}
          </span>
        </div>
        {sheet.canSignOff && !session.signedOffAt && (
          <Button variant="secondary" disabled={signOff.isPending} onClick={() => signOff.mutate()}>
            {t.signOff}
          </Button>
        )}
      </div>
      {signOff.isError && (
        <p role="alert" className="text-caption text-signal-stop-ink">
          {errorText(signOff.error)}
        </p>
      )}
      {sheet.openConflicts > 0 && (
        <p className="rounded-md bg-signal-warn-tint px-4 py-3 text-body text-signal-warn-ink">
          {t.conflictsHere(sheet.openConflicts)}
        </p>
      )}
      <ul className="panel divide-y divide-line">
        {sheet.students.map((st) => (
          <li key={st.personId} className="flex items-center gap-3 px-5 py-2.5">
            <span className="tabular w-6 shrink-0 text-caption text-ink-muted">
              {st.rollNumber ?? ''}
            </span>
            <span className="min-w-0 flex-1 truncate text-body text-ink">{st.name}</span>
            <span
              className={cx(
                'rounded-full border px-2.5 py-0.5 text-caption font-medium',
                STATUS_TILE[st.status ?? 'present'],
              )}
            >
              {t.statuses[st.status ?? 'present']}
            </span>
            {st.markedIn && (
              <span className="shrink-0 text-caption text-ink-muted">
                {t.markedIn(st.markedIn)}
              </span>
            )}
            {sheet.canMark && !st.markedIn && (
              <Button
                size="sm"
                variant="quiet"
                aria-label={`${t.correct}: ${st.name}`}
                onClick={() => {
                  setStatus(st.status === 'absent' ? 'present' : 'absent');
                  setCorrecting(st);
                }}
              >
                {t.correct}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {correcting && (
        <ReasonDialog
          title={t.correctTitle(correcting.name)}
          hint={t.correctHint}
          label={t.correctReason}
          action={t.correctAction}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setCorrecting(null)}
          submit={async (reason) => {
            await api.post('/school/attendance/corrections', {
              personId: correcting.personId,
              onDate: sheet.onDate,
              status,
              reason,
            });
            setMessage(`${correcting.name}: ${t.statuses[status]}`);
            await qc.invalidateQueries({ queryKey });
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.correctStatus}</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-9 rounded-md border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950"
            >
              {CORRECTABLE.map((c) => (
                <option key={c} value={c}>
                  {t.statuses[c]}
                </option>
              ))}
            </select>
          </label>
        </ReasonDialog>
      )}
      <Announcer message={message} />
    </section>
  );
}
