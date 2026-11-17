'use client';

// Academics › Attendance for colleges and universities (rule book §13.2: "period-wise (college)";
// "Shortage & Condonation: threshold from rule pack, alerts, condonation approval, feeds exam
// eligibility"): take a period for a section and course, see each student's standing per course,
// and ask for (or decide) a condonation through the workflow engine.
import type {
  AttendanceBoard,
  AttendanceSheet,
  MarkStatus,
} from '@campusverse/academics-attendance';
import type { StructureOverview } from '@campusverse/academics-structure';
import {
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
import { CalendarCheck } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';

const t = en.courseAttendance;
const STATUSES: MarkStatus[] = ['present', 'absent', 'on_duty'];
const TONE: Record<string, Tone> = {
  eligible: 'go',
  condoned: 'go',
  condonable: 'warn',
  short: 'stop',
  no_classes: 'neutral',
};
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const pct = (bp: number | null) => (bp === null ? '—' : `${(bp / 100).toFixed(2)}%`);
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function CourseAttendanceView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  const mark = can('academics.attendance.mark');
  const overview = useQuery({
    queryKey: ['academics', id],
    queryFn: () => api.get<StructureOverview>(`/academics/structure?institutionId=${id}`),
    enabled: !!id,
  });
  const batches = overview.data?.batches.filter((b) => b.status === 'running') ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const batchId = batches.find((b) => b.id === chosen)?.id ?? batches[0]?.id;
  const board = useQuery({
    queryKey: ['course-attendance', batchId],
    queryFn: () => api.get<AttendanceBoard>(`/academics/batches/${batchId}/attendance`),
    enabled: !!batchId,
  });
  const error = overview.error ?? board.error;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarCheck}
        area="teal"
        eyebrow={en.systems.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          batches.length > 0 ? (
            <label className="flex items-center gap-2 text-body text-ink">
              <span className="text-caption font-medium text-ink-muted">{t.batch}</span>
              <select
                value={batchId}
                onChange={(e) => setChosen(e.target.value)}
                className={`${fieldInput} min-w-56`}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.programCode} {b.label}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      />
      {error ? (
        error instanceof ApiFailure && error.status === 403 ? (
          <StatePanel
            kind="denied"
            title={en.states.denied.title}
            body={t.errors.forbidden ?? ''}
          />
        ) : typeof navigator !== 'undefined' && !navigator.onLine ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={errorText(error)} />
        )
      ) : !overview.data || (batchId && !board.data) ? (
        <SkeletonRows rows={4} label={en.states.loading.title} />
      ) : overview.data.profile === 'school' ? (
        <Section>
          <EmptyState icon={CalendarCheck} area="teal" title={t.schoolTitle} body={t.schoolBody} />
        </Section>
      ) : !batchId || !board.data ? (
        <Section>
          <EmptyState
            icon={CalendarCheck}
            area="teal"
            art="attendance"
            title={t.noBatches}
            body={t.noBatchesBody}
          />
        </Section>
      ) : (
        <>
          {mark && <Take board={board.data} />}
          <Standings board={board.data} />
        </>
      )}
    </div>
  );
}

function Take({ board }: { board: AttendanceBoard }) {
  const qc = useQueryClient();
  const [sectionId, setSection] = useState(board.sections[0]?.id ?? '');
  const [courseId, setCourse] = useState(board.courses[0]?.courseId ?? '');
  const [onDate, setDate] = useState(istToday());
  const [period, setPeriod] = useState(1);
  const [marks, setMarks] = useState<Record<string, MarkStatus>>({});
  const params = new URLSearchParams({ sectionId, courseId, onDate, period: String(period) });
  const sheet = useQuery({
    queryKey: ['course-attendance-sheet', board.batch.id, sectionId, courseId, onDate, period],
    queryFn: () =>
      api.get<AttendanceSheet>(`/academics/batches/${board.batch.id}/attendance/sheet?${params}`),
    enabled: !!sectionId && !!courseId && !!onDate,
  });
  const s = sheet.data;
  const statusOf = (personId: string, saved: MarkStatus | null): MarkStatus =>
    marks[personId] ?? saved ?? 'present';
  const save = useMutation({
    mutationFn: () =>
      api.post(`/academics/batches/${board.batch.id}/attendance`, {
        sectionId,
        courseId,
        onDate,
        period,
        marks: (s?.students ?? []).map((x) => ({
          studentId: x.personId,
          status: statusOf(x.personId, x.status),
        })),
      }),
    onSuccess: async () => {
      setMarks({});
      await qc.invalidateQueries({ queryKey: ['course-attendance'] });
      await qc.invalidateQueries({ queryKey: ['course-attendance-sheet'] });
    },
  });
  const absent = (s?.students ?? []).filter(
    (x) => statusOf(x.personId, x.status) === 'absent',
  ).length;
  const reset = () => (setMarks({}), save.reset());
  return (
    <Section id="take" title={t.take} description={t.takeLead} flush>
      <div className="flex flex-wrap items-end gap-3 px-6 pb-4">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink">{t.section}</span>
          <select
            value={sectionId}
            onChange={(e) => (setSection(e.target.value), reset())}
            className={fieldInput}
          >
            {board.sections.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-56 flex-col gap-1">
          <span className="text-caption font-medium text-ink">{t.course}</span>
          <select
            value={courseId}
            onChange={(e) => (setCourse(e.target.value), reset())}
            className={fieldInput}
          >
            {board.courses.map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.code} · {c.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink">{t.date}</span>
          <input
            type="date"
            max={istToday()}
            value={onDate}
            onChange={(e) => (setDate(e.target.value), reset())}
            className={fieldInput}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink">{t.period}</span>
          <select
            value={period}
            onChange={(e) => (setPeriod(Number(e.target.value)), reset())}
            className={fieldInput}
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {sheet.error ? (
        <p role="alert" className="px-6 pb-4 text-caption text-signal-stop-ink">
          {errorText(sheet.error)}
        </p>
      ) : !s ? (
        <div className="px-6 pb-5">
          <SkeletonRows rows={3} label={en.states.loading.title} />
        </div>
      ) : s.students.length === 0 ? (
        <p className="px-6 pb-5 text-body text-ink-muted">{t.noStudents}</p>
      ) : (
        <>
          {s.taken && (
            <p className="px-6 pb-2 text-caption text-ink-muted">{t.takenBy(s.taken.by)}</p>
          )}
          <ul className="divide-y divide-line border-t border-line">
            {s.students.map((x) => {
              const v = statusOf(x.personId, x.status);
              return (
                <li key={x.personId} className="flex flex-wrap items-center gap-3 px-6 py-2.5">
                  <span className="min-w-0 flex-1 text-body text-ink">
                    {x.name}
                    {x.registerNumber && (
                      <span className="tabular block text-caption text-ink-muted">
                        {x.registerNumber}
                      </span>
                    )}
                  </span>
                  <fieldset className="flex gap-1">
                    <legend className="sr-only">{t.statusFor(x.name)}</legend>
                    {STATUSES.map((st) => (
                      <label
                        key={st}
                        className={`cursor-pointer rounded-md border px-3 py-1 text-caption font-medium ${
                          v === st
                            ? st === 'absent'
                              ? 'border-signal-stop-ink bg-signal-stop-tint text-signal-stop-ink'
                              : 'border-navy-950 bg-navy-950 text-white'
                            : 'border-line text-ink'
                        } has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy-950`}
                      >
                        <input
                          type="radio"
                          name={`status-${x.personId}`}
                          value={st}
                          checked={v === st}
                          onChange={() => setMarks({ ...marks, [x.personId]: st })}
                          className="sr-only"
                        />
                        {t.statuses[st]}
                      </label>
                    ))}
                  </fieldset>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-4">
            <span className="tabular text-caption text-ink-muted">
              {t.summary(s.students.length - absent, absent)}
            </span>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {s.taken ? t.saveAgain : t.save}
            </Button>
          </div>
          {save.isSuccess && (
            <p role="status" className="px-6 pb-4 text-caption text-signal-go-ink">
              {t.saved}
            </p>
          )}
          {save.error && (
            <p role="alert" className="px-6 pb-4 text-caption text-signal-stop-ink">
              {errorText(save.error)}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function Standings({ board }: { board: AttendanceBoard }) {
  const qc = useQueryClient();
  const { can } = useMe();
  const mayAsk = can('academics.attendance.read') || can('academics.attendance.mark');
  const [asking, setAsking] = useState<{
    studentId: string;
    name: string;
    courseId: string;
    code: string;
  } | null>(null);
  const [refusing, setRefusing] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['course-attendance', board.batch.id] });
  const grant = useMutation({
    mutationFn: (id: string) =>
      api.post(`/academics/condonations/${id}/decision`, { approve: true, note: null }),
    onSettled: refresh,
  });
  return (
    <Section
      id="standing"
      title={t.standing}
      description={t.standingLead(board.rules.minimumPercent, board.rules.condonableFromPercent)}
      flush
    >
      {board.students.length === 0 ? (
        <p className="px-6 pb-5 text-body text-ink-muted">{t.noStudents}</p>
      ) : (
        // Focusable so keyboard users can scroll it on a phone.
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[640px] text-body">
            <caption className="sr-only">{t.standing}</caption>
            <thead>
              <tr className="border-y border-line bg-paper text-left text-caption tracking-wide text-ink-muted uppercase">
                <th scope="col" className="px-5 py-2 font-medium">
                  {t.student}
                </th>
                {board.courses.map((c) => (
                  <th key={c.courseId} scope="col" className="px-5 py-2 font-medium">
                    {c.code}
                    <span className="block font-normal normal-case">{t.held(c.sessions)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {board.students.map((s) => (
                <tr key={s.personId} className="align-top">
                  <th scope="row" className="px-5 py-3 text-left font-normal text-ink">
                    {s.name}
                    <span className="tabular block text-caption text-ink-muted">
                      {[s.registerNumber, s.section].filter(Boolean).join(' · ')}
                    </span>
                  </th>
                  {board.courses.map((c) => {
                    const x = s.courses[c.courseId];
                    if (!x)
                      return (
                        <td key={c.courseId} className="px-5 py-3 text-caption text-ink-muted">
                          {t.notTaking}
                        </td>
                      );
                    const cond = x.condonation;
                    return (
                      <td key={c.courseId} className="px-5 py-3">
                        <span className="tabular block text-ink">
                          {pct(x.basisPoints)}{' '}
                          <span className="text-caption text-ink-muted">
                            ({x.attended}/{x.held})
                          </span>
                        </span>
                        <Pill tone={TONE[x.standing] ?? 'neutral'}>{t.standings[x.standing]}</Pill>
                        {cond?.state === 'pending' && (
                          <span className="mt-1 block text-caption text-ink-muted">
                            {t.condonationPending}
                          </span>
                        )}
                        {cond?.state === 'pending' && cond.approval?.mine && (
                          <span className="mt-1 flex flex-wrap gap-1">
                            <Button
                              size="sm"
                              aria-label={t.grantFor(s.name, c.code)}
                              disabled={grant.isPending}
                              onClick={() => grant.mutate(cond.id)}
                            >
                              {t.grant}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={t.refuseFor(s.name, c.code)}
                              onClick={() => setRefusing(cond.id)}
                            >
                              {t.refuse}
                            </Button>
                          </span>
                        )}
                        {x.standing === 'condonable' && cond?.state !== 'pending' && mayAsk && (
                          <Button
                            size="sm"
                            variant="quiet"
                            className="mt-1"
                            aria-label={t.askFor(s.name, c.code)}
                            onClick={() =>
                              setAsking({
                                studentId: s.personId,
                                name: s.name,
                                courseId: c.courseId,
                                code: c.code,
                              })
                            }
                          >
                            {t.ask}
                          </Button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {grant.error && (
        <p role="alert" className="px-6 py-3 text-caption text-signal-stop-ink">
          {errorText(grant.error)}
        </p>
      )}
      {asking && (
        <NoteForm
          title={t.askTitle(asking.name, asking.code)}
          label={t.reason}
          submitLabel={t.ask}
          send={(reason) =>
            api.post(`/academics/batches/${board.batch.id}/condonations`, {
              courseId: asking.courseId,
              studentId: asking.studentId,
              reason,
            })
          }
          onClose={() => setAsking(null)}
          onDone={async () => (setAsking(null), await refresh())}
        />
      )}
      {refusing && (
        <NoteForm
          title={t.refuseTitle}
          label={t.why}
          submitLabel={t.refuse}
          send={(note) =>
            api.post(`/academics/condonations/${refusing}/decision`, { approve: false, note })
          }
          onClose={() => setRefusing(null)}
          onDone={async () => (setRefusing(null), await refresh())}
        />
      )}
    </Section>
  );
}

function NoteForm({
  title,
  label,
  submitLabel,
  send,
  onClose,
  onDone,
}: {
  title: string;
  label: string;
  submitLabel: string;
  send: (text: string) => Promise<unknown>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const m = useMutation({ mutationFn: () => send(text), onSuccess: onDone });
  return (
    <FormModal
      title={title}
      submitLabel={submitLabel}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={text.trim().length < 3}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={label} wide>
        <textarea
          required
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
