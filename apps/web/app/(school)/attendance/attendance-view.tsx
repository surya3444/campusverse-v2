'use client';

import type {
  AttendanceDay,
  HolidayPreview,
  LeaveItem,
  OpenConflict,
} from '@campusverse/school-attendance';
import {
  Announcer,
  Button,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  PreviewCanvas,
  ProgressRing,
  Stat,
  StatePanel,
  cx,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CalendarOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { ReasonDialog } from '../reason-dialog';
import { PendingBanner } from './pending-banner';
import { errorText, shortDate, t, useInstitution } from './shared';

const STATE_TONE: Record<string, Tone> = {
  not_taken: 'warn',
  submitted: 'go',
  signed_off: 'go',
  holiday: 'neutral',
};

export function AttendanceView() {
  const school = useInstitution();
  const id = school.institutionId;
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const day = useQuery({
    queryKey: ['attendance-day', id],
    queryFn: () => api.get<AttendanceDay>(`/school/attendance/${id}/day`),
    enabled: !!id,
  });

  if (school.isPending || (day.isPending && !!id)) {
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  }
  if (school.isError || day.isError) {
    const denied = day.error instanceof ApiFailure && day.error.status === 403;
    return denied ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={errorText(school.error ?? day.error)}
        action={en.states.error.action}
        onAction={() => void day.refetch()}
      />
    );
  }
  const d = day.data;
  if (!id || !d) return <StatePanel kind="empty" title={t.noSections} body={t.noSectionsBody} />;
  const taken = d.sections.filter((s) => s.state !== 'not_taken').length;
  const done = d.sections.filter((s) => s.state === 'submitted' || s.state === 'signed_off');
  const marked = done.reduce((n, s) => n + s.students, 0);
  const absent = done.reduce((n, s) => n + s.absent, 0);
  const present = marked - absent;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarCheck}
        art="attendance"
        area="teal"
        title={t.title}
        eyebrow={`${t.today} · ${shortDate(d.onDate)}`}
        description={t.lead}
        actions={
          d.seesAll ? (
            <>
              <Link
                href="/attendance/shortage"
                className="inline-flex h-9 items-center rounded-md border border-line-strong bg-surface px-3.5 text-body text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
              >
                {t.shortage}
              </Link>
              <HolidayAction institutionId={id} onDone={(m) => setMessage(m)} />
            </>
          ) : undefined
        }
      />

      {d.sections.length > 0 && !d.holiday && (
        <section
          aria-label={t.progress(taken, d.sections.length)}
          className="panel flex flex-wrap items-center gap-x-10 gap-y-5 p-5"
        >
          <div className="flex items-center gap-4">
            <ProgressRing
              value={taken}
              max={d.sections.length}
              size={64}
              tone={taken === d.sections.length ? 'go' : 'neutral'}
              label={t.progress(taken, d.sections.length)}
            >
              {Math.round((taken / d.sections.length) * 100)}%
            </ProgressRing>
            <div className="flex flex-col">
              <span className="text-body font-semibold text-ink">
                {t.progress(taken, d.sections.length)}
              </span>
              <span
                className={
                  taken === d.sections.length
                    ? 'text-caption text-signal-go-ink'
                    : 'text-caption text-signal-warn-ink'
                }
              >
                {taken === d.sections.length
                  ? t.allMarked
                  : t.stillToMark(d.sections.length - taken)}
              </span>
            </div>
          </div>
          {taken > 0 && (
            <>
              <Stat label={t.presentToday} value={present} note={`/ ${marked}`} />
              <Stat
                label={t.absentToday}
                value={absent}
                {...(absent > 0 ? { tone: 'warn' as const } : {})}
              />
              <Stat
                label={t.rate}
                value={`${marked ? Math.round((present / marked) * 100) : 0}%`}
              />
            </>
          )}
        </section>
      )}

      <PendingBanner />

      {d.holiday && (
        <p className="panel flex items-center gap-3 px-5 py-3 text-body text-ink">
          <CalendarOff aria-hidden className="size-4 text-ink-muted" />
          {t.holidayToday(d.holiday)}
        </p>
      )}

      {d.sections.length === 0 ? (
        <StatePanel
          kind="empty"
          title={d.seesAll ? t.noSections : t.notMine}
          body={d.seesAll ? t.noSectionsBody : ''}
        />
      ) : (
        <section aria-labelledby="sections" tabIndex={0} className="panel relative overflow-x-auto">
          <h2
            id="sections"
            className="border-b border-line px-5 py-3 text-body font-semibold text-ink"
          >
            {d.seesAll ? t.sections : t.mineOnly}
          </h2>
          <table className="w-full min-w-[560px] text-body">
            <thead>
              <tr className="border-b border-line bg-paper text-left text-caption text-ink-muted">
                <th scope="col" className="px-5 py-2.5 font-medium">
                  {t.section}
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  {t.classTeacher}
                </th>
                <th scope="col" className="px-5 py-2.5 font-medium">
                  {t.state}
                </th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">
                  {t.absent}
                </th>
                <th scope="col" className="px-5 py-2.5">
                  <span className="sr-only">{t.mark}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.sections.map((s) => (
                <tr key={s.sectionId} className="hover:bg-paper">
                  <td className="px-5 py-3 font-medium text-ink">{s.label}</td>
                  <td className="px-5 py-3 text-ink-muted">{s.classTeacherName ?? t.noTeacher}</td>
                  <td className="px-5 py-3">
                    <Pill tone={STATE_TONE[s.state] ?? 'neutral'}>{t.states[s.state]}</Pill>
                  </td>
                  <td className="tabular px-5 py-3 text-right text-ink">
                    {s.state === 'not_taken' || s.state === 'holiday'
                      ? '—'
                      : `${s.absent} / ${s.students}`}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/attendance/${s.sectionId}`}
                      className={cx(
                        'inline-flex h-8 items-center rounded-md px-3 text-caption font-medium',
                        s.mine && s.state === 'not_taken'
                          ? 'bg-navy-950 text-white hover:bg-navy-900'
                          : 'text-navy-950 hover:bg-navy-50',
                      )}
                    >
                      {s.mine && s.state === 'not_taken' ? t.mark : t.view}
                    </Link>
                    <Link
                      href={`/attendance/${s.sectionId}/register`}
                      className="ml-1 inline-flex h-8 items-center rounded-md px-3 text-caption text-ink-muted hover:bg-paper hover:text-ink"
                    >
                      {t.register}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <LeaveRequests
          institutionId={id}
          onChange={() => void qc.invalidateQueries({ queryKey: ['attendance-day', id] })}
        />
        {d.seesAll && (
          <Conflicts
            institutionId={id}
            onChange={() => void qc.invalidateQueries({ queryKey: ['attendance-day', id] })}
          />
        )}
      </div>

      <Announcer message={message} />
    </div>
  );
}

function LeaveRequests({
  institutionId,
  onChange,
}: {
  institutionId: string;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<LeaveItem | null>(null);
  const leave = useQuery({
    queryKey: ['attendance-leave', institutionId],
    queryFn: () => api.get<LeaveItem[]>(`/school/attendance/${institutionId}/leave`),
    retry: false,
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean; note?: string }) =>
      api.post(`/school/attendance/leave/${v.id}/decide`, {
        approve: v.approve,
        note: v.note ?? null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance-leave', institutionId] });
      onChange();
    },
  });
  // Roles without leave decisions simply don't see the panel.
  if (leave.error instanceof ApiFailure && leave.error.status === 403) return null;
  return (
    <section aria-labelledby="leave" className="panel">
      <h2 id="leave" className="border-b border-line px-5 py-3 text-body font-semibold text-ink">
        {t.leave}
      </h2>
      {leave.isPending ? (
        <p className="px-5 py-4 text-body text-ink-muted">{en.states.loading.title}</p>
      ) : leave.isError ? (
        <p role="alert" className="px-5 py-4 text-body text-signal-stop-ink">
          {errorText(leave.error)}
        </p>
      ) : leave.data.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{t.noReview}</p>
      ) : (
        <ul className="divide-y divide-line">
          {leave.data.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-medium text-ink">
                  {l.studentName} · {l.sectionLabel}
                </span>
                <span className="text-caption text-ink-muted">
                  {t.kinds[l.kind]} · {t.leaveLine(shortDate(l.from), shortDate(l.to))} · {l.reason}
                </span>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setRejecting(l)}>
                {t.reject}
              </Button>
              <Button
                size="sm"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: l.id, approve: true })}
              >
                {t.approve}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {decide.isError && (
        <p role="alert" className="px-5 pb-3 text-caption text-signal-stop-ink">
          {errorText(decide.error)}
        </p>
      )}
      {rejecting && (
        <ReasonDialog
          title={t.rejectTitle}
          hint={t.rejectHint}
          label={t.rejectNote}
          action={t.reject}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setRejecting(null)}
          submit={async (note) => {
            await decide.mutateAsync({ id: rejecting.id, approve: false, note });
          }}
        />
      )}
    </section>
  );
}

function Conflicts({ institutionId, onChange }: { institutionId: string; onChange: () => void }) {
  const qc = useQueryClient();
  const conflicts = useQuery({
    queryKey: ['attendance-conflicts', institutionId],
    queryFn: () => api.get<OpenConflict[]>(`/school/attendance/${institutionId}/conflicts`),
  });
  const resolve = useMutation({
    mutationFn: (v: { id: string; apply: boolean }) =>
      api.post(`/school/attendance/conflicts/${v.id}/resolve`, { apply: v.apply }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['attendance-conflicts', institutionId] });
      onChange();
    },
  });
  return (
    <section aria-labelledby="conflicts" className="panel">
      <h2
        id="conflicts"
        className="border-b border-line px-5 py-3 text-body font-semibold text-ink"
      >
        {t.conflicts}
      </h2>
      {conflicts.isPending ? (
        <p className="px-5 py-4 text-body text-ink-muted">{en.states.loading.title}</p>
      ) : conflicts.isError ? (
        <p role="alert" className="px-5 py-4 text-body text-signal-stop-ink">
          {errorText(conflicts.error)}
        </p>
      ) : conflicts.data.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{t.noReview}</p>
      ) : (
        <ul className="divide-y divide-line">
          {conflicts.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-ink">
                  {t.conflictLine(
                    c.name,
                    t.statuses[c.current] ?? c.current,
                    t.statuses[c.incoming] ?? c.incoming,
                    c.incomingBy,
                  )}
                </span>
                <span className="text-caption text-ink-muted">
                  {c.sectionLabel} · {shortDate(c.onDate)}
                </span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: c.id, apply: false })}
              >
                {t.keep}
              </Button>
              <Button
                size="sm"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: c.id, apply: true })}
              >
                {t.apply}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {resolve.isError && (
        <p role="alert" className="px-5 pb-3 text-caption text-signal-stop-ink">
          {errorText(resolve.error)}
        </p>
      )}
    </section>
  );
}

/** Declare holiday: a date and name, then the Preview Canvas with counts, then commit. */
function HolidayAction({
  institutionId,
  onDone,
}: {
  institutionId: string;
  onDone: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [onDate, setOnDate] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<HolidayPreview | null>(null);
  const ask = useMutation({
    mutationFn: () =>
      api.post<HolidayPreview>(`/school/attendance/${institutionId}/holidays/preview`, {
        onDate,
        name,
      }),
    onSuccess: (p) => {
      setOpen(false);
      setPreview(p);
    },
  });
  const commit = useMutation({
    mutationFn: () => api.post(`/school/attendance/${institutionId}/holidays`, { onDate, name }),
    onSuccess: () => {
      setPreview(null);
      onDone(t.holidayDone(name));
      void qc.invalidateQueries({ queryKey: ['attendance-day', institutionId] });
    },
  });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t.declareHoliday}
      </Button>
      {open && (
        <FormModal
          title={t.declareHoliday}
          size="md"
          submitLabel={t.preview}
          cancelLabel={en.form.cancel}
          pending={ask.isPending}
          error={ask.isError ? errorText(ask.error) : null}
          onClose={() => {
            ask.reset();
            setOpen(false);
          }}
          onSubmit={() => ask.mutate()}
        >
          <ModalField label={t.holidayDate}>
            <input
              type="date"
              required
              value={onDate}
              onChange={(e) => setOnDate(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
          <ModalField label={t.holidayName}>
            <input
              required
              minLength={2}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
        </FormModal>
      )}
      <PreviewCanvas
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={t.holidayTitle}
        actionLabel={t.declareHoliday}
        changes={preview ? t.holidayChanges(preview.name, shortDate(preview.onDate)) : []}
        affected={
          preview
            ? [
                { label: t.holidaySections, count: preview.sections },
                { label: t.holidayStudents, count: preview.students },
                { label: t.holidayMarked, count: preview.alreadyMarked },
              ]
            : []
        }
        risks={
          preview && preview.absencesAlreadyAlerted > 0
            ? [t.holidayRisk(preview.absencesAlreadyAlerted)]
            : []
        }
        undo={t.holidayUndo}
        busy={commit.isPending}
        labels={en.preview}
        onConfirm={() => commit.mutate()}
      />
    </>
  );
}
