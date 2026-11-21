'use client';

// The timetable generator (after the hub's), as one guided flow on the timetable screen (owner's
// brief, 21 Nov 2026): the school day, each class's subjects and periods a week, who teaches what
// to which section, the rules and preferences, a check that it all fits; then a working view while
// the worker searches, the week as it would be, placing it, and publishing it from a date.
import type { Generation, Rules, TimetableDetail } from '@campusverse/school-timetable';
import { Button, KeyFigures, Segmented, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../lib/api';
import { fieldInput } from '../common/custom-fields';
import { date, errorText, t } from './shared';
import { PALETTE, subjectColors } from './lesson-card';
import { ScheduleFields, scheduleBody, scheduleOf, scheduleReady, type Schedule } from './forms';
import { ReviewStep, SubjectsStep, TeachersStep, readiness, useSubjects } from './plan-steps';

const g = t.generate;
type Tab = 'basics' | 'wishes' | 'subjects' | 'teachers';
type Stage = 'setup' | 'working' | 'result' | 'placed';
const STEPS = ['day', 'subjects', 'teachers', 'rules', 'review'] as const;
type Step = (typeof STEPS)[number];
const w = t.wizard;

/** Ink-on-tint pairs from the design tokens (4.5:1 or more); handed out in subject order. */

/** A small on/off pill, for days and periods. `label` is read before the visible text. */
function Chip({
  on,
  label,
  children,
  onClick,
}: {
  on: boolean;
  label: string;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cx(
        'h-7 min-w-9 rounded-full px-2.5 text-caption font-medium ring-1 transition-colors',
        on
          ? 'bg-navy-950 text-white ring-navy-950'
          : 'bg-surface text-ink-muted ring-line hover:text-ink hover:ring-navy-950/40',
      )}
    >
      <span className="sr-only">{label} </span>
      {children}
    </button>
  );
}

/** A number with − and +, as the hub's generator has. */
function Stepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-ink">{label}</span>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${label}: −1`}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          −
        </Button>
        <span
          aria-live="polite"
          className="tabular w-8 text-center font-display text-lead font-semibold text-ink"
        >
          {value}
        </span>
        <Button
          size="sm"
          variant="secondary"
          aria-label={`${label}: +1`}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          +
        </Button>
      </div>
    </div>
  );
}

const toggle = (xs: number[] | undefined, x: number) =>
  xs?.includes(x) ? xs.filter((y) => y !== x) : [...(xs ?? []), x].sort((a, b) => a - b);

export function TimetableGenerator({
  institutionId,
  detail,
  firstStep = 'day',
  onClose,
  onDone,
}: {
  institutionId: string;
  detail: TimetableDetail;
  firstStep?: Step;
  onClose: () => void;
  /** Placed (and perhaps published): the screen refreshes and says so. */
  onDone: (message: string) => void;
}) {
  const id = detail.version.id;
  const { plan, staff, periods, version, slots } = detail;
  const qc = useQueryClient();
  const [rules, setRules] = useState<Rules>(detail.rules);
  const [tab, setTab] = useState<Tab>('basics');
  const [step, setStep] = useState<Step>(firstStep);
  const [schedule, setSchedule] = useState<Schedule>(() => scheduleOf(detail));
  const subjectsData = useSubjects(institutionId);
  const capacity = version.days.length * periods.filter((p) => p.kind === 'class').length;
  const limits = Object.fromEntries(
    Object.entries(rules.teachers).map(([k, v]) => [k, v?.maxPerWeek]),
  );
  const checks = subjectsData.data ? readiness(subjectsData.data, capacity, limits) : [];
  const blocked = checks.some((c) => c.tone === 'stop');
  const saveDay = useMutation({
    mutationFn: () => api.put(`/school/timetable/${id}/schedule`, scheduleBody(schedule)),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['timetable'] });
      await qc.invalidateQueries({ queryKey: ['timetables'] });
      setStep('subjects');
    },
  });
  const dayChanged =
    JSON.stringify(scheduleBody(schedule)) !== JSON.stringify(scheduleBody(scheduleOf(detail)));
  const next = () => {
    if (step === 'day' && dayChanged) return saveDay.mutate();
    const i = STEPS.indexOf(step);
    setStep(STEPS[Math.min(i + 1, STEPS.length - 1)] ?? 'review');
  };
  const back = () => setStep(STEPS[Math.max(STEPS.indexOf(step) - 1, 0)] ?? 'day');
  const [placedCount, setPlacedCount] = useState<number | null>(null);
  const [from, setFrom] = useState(() =>
    new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
  );
  const publish = useMutation({
    mutationFn: () => api.post(`/school/timetable/${id}/publish`, { effectiveFrom: from }),
    onSuccess: () => onDone(w.publishedFrom(date(from))),
  });
  const [runId, setRunId] = useState<string | null>(null);
  const [backToSetup, setBackToSetup] = useState(false);
  const start = useMutation({
    mutationFn: (r: Rules) =>
      api.post<{ id: string }>(`/school/timetable/${id}/generate`, { rules: r }),
    onSuccess: (r) => {
      setBackToSetup(false);
      setRunId(r.id);
    },
  });
  const run = useQuery({
    queryKey: ['timetable-generation', runId],
    queryFn: () => api.get<Generation>(`/school/timetable/${id}/generate/${runId}`),
    enabled: !!runId,
    // Stops asking once the run is done, failed, or nothing has picked it up.
    refetchInterval: (q) =>
      q.state.data?.state === 'working' && !q.state.data.stuck ? 800 : false,
  });
  const place = useMutation({
    mutationFn: () =>
      api.post<{ placed: number }>(`/school/timetable/${id}/generate/${runId}/place`),
    onSuccess: async (r) => {
      setPlacedCount(r.placed);
      await qc.invalidateQueries({ queryKey: ['timetable'] });
      await qc.invalidateQueries({ queryKey: ['timetables'] });
    },
  });
  const stuck = !!run.data?.stuck;
  const working =
    start.isPending || (run.data?.state === 'working' && !stuck) || (!!runId && run.isPending);
  const result = run.data?.state === 'ready' ? run.data.result : null;
  const stage: Stage =
    placedCount !== null
      ? 'placed'
      : working
        ? 'working'
        : result && !backToSetup
          ? 'result'
          : 'setup';
  const go = (seed: number) => {
    const next = { ...rules, seed };
    setRules(next);
    start.mutate(next);
  };

  const subjects = useMemo(
    () =>
      [...new Map(plan.offerings.map((o) => [o.subjectId, o])).values()]
        .filter((o) => o.periodsPerWeek)
        .sort((a, b) => a.code.localeCompare(b.code)),
    [plan.offerings],
  );
  // The same colours as the week editor (lesson-card's subjectColors).
  const colorOf = subjectColors(subjects.map((o) => o.subjectId));
  const colour = new Map(subjects.map((o) => [o.subjectId, colorOf(o.subjectId)]));
  const teacherIds = [...new Set(plan.teachers.map((x) => x.personId))];
  const name = new Map(staff.map((x) => [x.personId, x.name]));
  const classPeriods = periods.flatMap((p) => (p.ordinal ? [p.ordinal] : []));
  const toPlace = Object.values(detail.targets)
    .flat()
    .reduce((n, x) => n + Math.max(0, (x.target ?? 0) - x.placed), 0);
  const sub = (sid: string, patch: Partial<Rules['subjects'][string]>) =>
    setRules((x) => ({
      ...x,
      subjects: { ...x.subjects, [sid]: { ...x.subjects[sid], ...patch } },
    }));
  const tea = (pid: string, patch: Partial<Rules['teachers'][string]>) =>
    setRules((x) => ({
      ...x,
      teachers: { ...x.teachers, [pid]: { ...x.teachers[pid], ...patch } },
    }));
  const num = (v: string) => (v ? Number(v) : undefined);
  const small = 'h-8 rounded-lg border border-line bg-surface px-2 text-caption text-ink';
  const error =
    run.data?.state === 'failed'
      ? g.failed
      : stuck
        ? g.stuck
        : start.error
          ? errorText(start.error)
          : place.error
            ? errorText(place.error)
            : saveDay.error
              ? errorText(saveDay.error)
              : publish.error
                ? errorText(publish.error)
                : run.data?.stale
                  ? String(t.errors.changed)
                  : null;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && !working && !place.isPending && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-midnight-950/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--shadow-overlay)] outline-none">
          <header className="flex items-start gap-3 bg-navy-950 px-6 py-5 text-white">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
              <Wand2 aria-hidden className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="font-display text-lead font-semibold">
                {g.heading}
              </Dialog.Title>
              <Dialog.Description className="text-caption text-white/80">
                {g.sub}
              </Dialog.Description>
            </div>
            <Dialog.Close
              aria-label={t.cancel}
              disabled={working || place.isPending}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
            >
              <X aria-hidden className="size-4" />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {stage === 'setup' && (
              <ol className="mb-5 flex flex-wrap gap-2" aria-label={w.stepsLabel}>
                {STEPS.map((k, i) => {
                  const at = STEPS.indexOf(step);
                  return (
                    <li key={k}>
                      <button
                        type="button"
                        aria-current={k === step ? 'step' : undefined}
                        disabled={
                          saveDay.isPending || (step === 'day' && dayChanged && k !== 'day')
                        }
                        onClick={() => setStep(k)}
                        className={cx(
                          'flex items-center gap-2 rounded-full py-1.5 pr-3 pl-1.5 text-caption font-medium ring-1',
                          k === step
                            ? 'bg-navy-950 text-white ring-navy-950'
                            : i < at
                              ? 'bg-navy-50 text-navy-950 ring-navy-200'
                              : 'bg-surface text-ink-muted ring-line',
                        )}
                      >
                        <span
                          aria-hidden
                          className={cx(
                            'flex size-5 items-center justify-center rounded-full text-[0.6875rem]',
                            k === step ? 'bg-white text-navy-950' : 'bg-navy-50 text-navy-950',
                          )}
                        >
                          {i < at ? <Check className="size-3" /> : i + 1}
                        </span>
                        {w.steps[k]}
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            {stage === 'setup' && step === 'day' && (
              <div className="flex flex-col gap-4">
                <p className="text-body text-ink">{w.dayLead}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ScheduleFields value={schedule} onChange={setSchedule} />
                </div>
                {dayChanged && slots.length > 0 && (
                  <p className="rounded-lg bg-signal-warn-tint px-3 py-2 text-caption text-signal-warn-ink">
                    {w.dayWarning}
                  </p>
                )}
              </div>
            )}
            {stage === 'setup' &&
              (step === 'subjects' || step === 'teachers' || step === 'review') &&
              (subjectsData.isPending ? (
                <StatePanel kind="loading" title={w.loading} />
              ) : subjectsData.isError || !subjectsData.data ? (
                <StatePanel kind="error" title={w.errors.error ?? ''} />
              ) : step === 'subjects' ? (
                <SubjectsStep
                  institutionId={institutionId}
                  overview={subjectsData.data}
                  capacity={capacity}
                />
              ) : step === 'teachers' ? (
                <TeachersStep
                  institutionId={institutionId}
                  overview={subjectsData.data}
                  capacity={capacity}
                  limits={limits}
                />
              ) : (
                <div className="flex flex-col gap-5">
                  <KeyFigures
                    variant="strip"
                    label={g.heading}
                    figures={[
                      { label: g.summary.sections, value: String(plan.sections.length) },
                      { label: g.summary.toPlace, value: String(toPlace) },
                      { label: g.summary.teachers, value: String(teacherIds.length) },
                      { label: g.summary.days, value: String(version.days.length) },
                    ]}
                  />
                  <ReviewStep checks={checks} />
                  <fieldset className="flex flex-col gap-2">
                    <legend className="mb-2 text-caption font-medium text-ink">{g.how}</legend>
                    {(['fill', 'rebuild'] as const).map((m) => (
                      <label
                        key={m}
                        className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line has-[:checked]:bg-navy-50 has-[:checked]:ring-2 has-[:checked]:ring-navy-950"
                      >
                        <input
                          type="radio"
                          name="generate-mode-review"
                          className="mt-1"
                          checked={rules.mode === m}
                          onChange={() => setRules((x) => ({ ...x, mode: m }))}
                        />
                        <span className="text-body text-ink">{g.modes[m]}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
              ))}
            {stage === 'setup' && step === 'rules' && (
              <div className="flex flex-col gap-5">
                <p className="text-body text-ink">{w.rulesLead}</p>
                <Segmented
                  label={g.heading}
                  value={tab}
                  onChange={setTab}
                  options={(['basics', 'wishes', 'subjects', 'teachers'] as const).map((k) => ({
                    value: k,
                    label: g.tabs[k] ?? k,
                  }))}
                />

                {tab === 'basics' && (
                  <div className="grid gap-6 md:grid-cols-2">
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-2 text-caption font-medium text-ink">{g.how}</legend>
                      {(['fill', 'rebuild'] as const).map((m) => (
                        <label
                          key={m}
                          className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line has-[:checked]:bg-navy-50 has-[:checked]:ring-2 has-[:checked]:ring-navy-950"
                        >
                          <input
                            type="radio"
                            name="generate-mode"
                            className="mt-1"
                            checked={rules.mode === m}
                            onChange={() => setRules((x) => ({ ...x, mode: m }))}
                          />
                          <span className="text-body text-ink">{g.modes[m]}</span>
                        </label>
                      ))}
                    </fieldset>
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-2 text-caption font-medium text-ink">{g.effort}</legend>
                      {(['quick', 'standard', 'thorough'] as const).map((e) => (
                        <label
                          key={e}
                          className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line has-[:checked]:bg-navy-50 has-[:checked]:ring-2 has-[:checked]:ring-navy-950"
                        >
                          <input
                            type="radio"
                            name="generate-effort"
                            className="mt-1"
                            checked={(rules.effort ?? 'standard') === e}
                            onChange={() => setRules((x) => ({ ...x, effort: e }))}
                          />
                          <span className="flex flex-col">
                            <span className="text-body font-medium text-ink">{g.efforts[e]}</span>
                            <span className="text-caption text-ink-muted">{g.effortHint[e]}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    <div className="flex flex-col gap-4 md:col-span-2">
                      <p className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
                        {g.hardRules}
                      </p>
                      <div className="grid gap-5 sm:grid-cols-3">
                        <Stepper
                          label={g.maxSame}
                          value={rules.maxSamePerDay}
                          min={1}
                          max={4}
                          onChange={(n) => setRules((x) => ({ ...x, maxSamePerDay: n }))}
                        />
                        <Stepper
                          label={g.teacherMax}
                          value={rules.teacherMaxPerDay}
                          min={1}
                          max={16}
                          onChange={(n) => setRules((x) => ({ ...x, teacherMaxPerDay: n }))}
                        />
                        <Stepper
                          label={g.teacherRow}
                          value={rules.teacherMaxInARow}
                          min={1}
                          max={16}
                          onChange={(n) => setRules((x) => ({ ...x, teacherMaxInARow: n }))}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {tab === 'wishes' && (
                  <div className="flex flex-col gap-5">
                    <p className="text-caption text-ink-muted">{g.wishesLead}</p>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={!!rules.classTeacherFirst}
                        onChange={(e) =>
                          setRules((x) => ({ ...x, classTeacherFirst: e.target.checked }))
                        }
                      />
                      <span className="flex flex-col">
                        <span className="text-body font-medium text-ink">
                          {g.classTeacherFirst}
                        </span>
                        <span className="text-caption text-ink-muted">
                          {g.classTeacherFirstHint}
                        </span>
                      </span>
                    </label>
                    <fieldset className="flex flex-col gap-2">
                      <legend className="mb-2 text-caption font-medium text-ink">
                        {g.teacherDay}
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {(['balanced', 'compact'] as const).map((k) => (
                          <label
                            key={k}
                            className="flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-1 ring-line has-[:checked]:bg-navy-50 has-[:checked]:ring-2 has-[:checked]:ring-navy-950"
                          >
                            <input
                              type="radio"
                              name="teacher-day"
                              checked={(rules.teacherDay ?? 'balanced') === k}
                              onChange={() => setRules((x) => ({ ...x, teacherDay: k }))}
                            />
                            <span className="text-body text-ink">{g.teacherDays[k]}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                )}

                {tab === 'subjects' && (
                  <div className="flex flex-col gap-3">
                    <p className="text-caption text-ink-muted">
                      {g.subjectsHint} {g.roomsHint}
                    </p>
                    <ul className="flex flex-col gap-3">
                      {subjects.map((o) => {
                        const v = rules.subjects[o.subjectId] ?? {};
                        const c = colour.get(o.subjectId) ?? PALETTE[0];
                        return (
                          <li
                            key={o.subjectId}
                            className="relative overflow-hidden rounded-xl p-4 pl-5 ring-1 ring-line"
                          >
                            <span
                              aria-hidden
                              className={cx('absolute inset-y-0 left-0 w-1', c.bar)}
                            />
                            <p className="mb-3 font-medium text-ink">
                              {o.code} · {o.name}
                            </p>
                            <div className="grid gap-x-5 gap-y-3 md:grid-cols-4">
                              <label className="flex flex-col gap-1 text-caption text-ink-muted">
                                {g.doubles}
                                <select
                                  className={small}
                                  aria-label={`${g.doubles}: ${o.name}`}
                                  value={v.doubles ?? 0}
                                  onChange={(e) =>
                                    sub(o.subjectId, { doubles: Number(e.target.value) })
                                  }
                                >
                                  {[0, 1, 2, 3, 4].map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 text-caption text-ink-muted">
                                {g.time}
                                <select
                                  className={small}
                                  aria-label={`${g.time}: ${o.name}`}
                                  value={v.time ?? 'any'}
                                  onChange={(e) =>
                                    sub(o.subjectId, {
                                      time: e.target.value as 'any' | 'morning' | 'afternoon',
                                    })
                                  }
                                >
                                  {(['any', 'morning', 'afternoon'] as const).map((x) => (
                                    <option key={x} value={x}>
                                      {g.timeOf[x]}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 text-caption text-ink-muted">
                                {g.subjectMax}
                                <select
                                  className={small}
                                  aria-label={`${g.subjectMax}: ${o.name}`}
                                  value={v.maxPerDay ?? ''}
                                  onChange={(e) =>
                                    sub(o.subjectId, { maxPerDay: num(e.target.value) })
                                  }
                                >
                                  <option value="">{g.schoolRule}</option>
                                  {[1, 2, 3, 4].map((n) => (
                                    <option key={n} value={n}>
                                      {g.times(n)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex items-center gap-2 self-end pb-1 text-body text-ink">
                                <input
                                  type="checkbox"
                                  aria-label={`${g.samePeriod}: ${o.name}`}
                                  checked={!!v.samePeriod}
                                  onChange={(e) =>
                                    sub(o.subjectId, { samePeriod: e.target.checked })
                                  }
                                />
                                {g.samePeriod}
                              </label>
                              <div className="flex flex-col gap-1 md:col-span-2">
                                <span className="text-caption text-ink-muted">
                                  {g.avoidPeriods}
                                </span>
                                <div className="flex flex-wrap gap-1.5">
                                  {classPeriods.map((n) => (
                                    <Chip
                                      key={n}
                                      on={!!v.avoidPeriods?.includes(n)}
                                      label={g.avoidFor(o.name)}
                                      onClick={() =>
                                        sub(o.subjectId, {
                                          avoidPeriods: toggle(v.avoidPeriods, n),
                                        })
                                      }
                                    >
                                      {`P${n}`}
                                    </Chip>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-col gap-1 md:col-span-2">
                                <span className="text-caption text-ink-muted">{g.subjectDays}</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {version.days.map((d) => (
                                    <Chip
                                      key={d}
                                      on={!!v.days?.includes(d)}
                                      label={g.subjectDayFor(o.name)}
                                      onClick={() => sub(o.subjectId, { days: toggle(v.days, d) })}
                                    >
                                      {t.daysShort[d]}
                                    </Chip>
                                  ))}
                                </div>
                              </div>
                              <label className="flex flex-col gap-1 text-caption text-ink-muted md:col-span-4">
                                {g.rooms}
                                <input
                                  className={fieldInput}
                                  aria-label={`${g.rooms}: ${o.name}`}
                                  defaultValue={(v.rooms ?? []).join(', ')}
                                  onBlur={(e) =>
                                    sub(o.subjectId, {
                                      rooms: e.target.value
                                        .split(',')
                                        .map((x) => x.trim())
                                        .filter(Boolean)
                                        .slice(0, 10),
                                    })
                                  }
                                />
                              </label>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {tab === 'teachers' && (
                  <div className="flex flex-col gap-3">
                    <p className="text-caption text-ink-muted">{g.teachersHint}</p>
                    <ul className="flex flex-col gap-3">
                      {teacherIds.map((pid) => {
                        const v = rules.teachers[pid] ?? {};
                        const who = name.get(pid) ?? '';
                        return (
                          <li
                            key={pid}
                            className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-line"
                          >
                            <p className="font-medium text-ink">{who}</p>
                            <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">
                              <div className="flex flex-col gap-1">
                                <span className="text-caption text-ink-muted">{g.offDays}</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {version.days.map((d) => (
                                    <Chip
                                      key={d}
                                      on={!!v.offDays?.includes(d)}
                                      label={g.offDayFor(who)}
                                      onClick={() => tea(pid, { offDays: toggle(v.offDays, d) })}
                                    >
                                      {t.daysShort[d]}
                                    </Chip>
                                  ))}
                                </div>
                              </div>
                              <div className="flex flex-col gap-1">
                                <span className="text-caption text-ink-muted">{g.offPeriods}</span>
                                <div className="flex flex-wrap gap-1.5">
                                  {classPeriods.map((n) => (
                                    <Chip
                                      key={n}
                                      on={!!v.offPeriods?.includes(n)}
                                      label={g.offPeriodFor(who)}
                                      onClick={() =>
                                        tea(pid, { offPeriods: toggle(v.offPeriods, n) })
                                      }
                                    >
                                      {`P${n}`}
                                    </Chip>
                                  ))}
                                </div>
                              </div>
                              <label className="flex items-center gap-2 text-caption text-ink-muted">
                                {g.teacherOwnMax}
                                <select
                                  className={small}
                                  aria-label={`${g.teacherOwnMax}: ${who}`}
                                  value={v.maxPerDay ?? ''}
                                  onChange={(e) => tea(pid, { maxPerDay: num(e.target.value) })}
                                >
                                  <option value="">{g.schoolRule}</option>
                                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                                    <option key={n} value={n}>
                                      {n}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="flex items-center gap-2 text-caption text-ink-muted">
                                {g.teacherWeek}
                                <input
                                  type="number"
                                  min={1}
                                  max={80}
                                  className={cx(small, 'w-20')}
                                  aria-label={`${g.teacherWeek}: ${who}`}
                                  value={v.maxPerWeek ?? ''}
                                  onChange={(e) => tea(pid, { maxPerWeek: num(e.target.value) })}
                                />
                              </label>
                            </div>
                            <details className="rounded-lg bg-paper">
                              <summary className="cursor-pointer px-3 py-1.5 text-caption text-ink-muted">
                                {g.offTimes} · {g.offTimesCount(v.offCells?.length ?? 0)}
                              </summary>
                              <div className="overflow-x-auto p-2">
                                <table className="text-caption">
                                  <thead>
                                    <tr>
                                      <th className="px-1">
                                        <span className="sr-only">{t.periods}</span>
                                      </th>
                                      {version.days.map((d) => (
                                        <th
                                          key={d}
                                          scope="col"
                                          className="px-1 font-medium text-ink-muted"
                                        >
                                          {t.daysShort[d]}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {classPeriods.map((n) => (
                                      <tr key={n}>
                                        <th
                                          scope="row"
                                          className="px-1 text-left font-medium text-ink-muted"
                                        >
                                          {`P${n}`}
                                        </th>
                                        {version.days.map((d) => {
                                          const key = `${d}:${n}`;
                                          return (
                                            <td key={d} className="px-1 text-center">
                                              <input
                                                type="checkbox"
                                                aria-label={g.offCellFor(who, t.days[d] ?? '', n)}
                                                checked={!!v.offCells?.includes(key)}
                                                onChange={(e) =>
                                                  tea(pid, {
                                                    offCells: e.target.checked
                                                      ? [...(v.offCells ?? []), key]
                                                      : (v.offCells ?? []).filter((x) => x !== key),
                                                  })
                                                }
                                              />
                                            </td>
                                          );
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {stage === 'working' && <Working />}

            {stage === 'placed' && (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <CheckCircle2 aria-hidden className="size-12 text-signal-go" />
                <h3 className="font-display text-title font-semibold text-ink">
                  {g.done(placedCount ?? 0)}
                </h3>
                <p className="max-w-lg text-body text-ink-muted">{w.placedLead}</p>
              </div>
            )}

            {stage === 'result' && result && (
              <Result
                detail={detail}
                result={result}
                colour={colour}
                name={name}
                existing={slots}
              />
            )}
          </div>

          <footer className="flex flex-col gap-3 border-t border-line bg-paper/60 px-6 py-4">
            {error && (
              <p
                role="alert"
                className="rounded-lg bg-signal-stop-tint px-3 py-2 text-caption text-signal-stop-ink"
              >
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {stage === 'setup' && (
                <>
                  {step === 'day' ? (
                    <Button variant="quiet" onClick={onClose}>
                      {t.cancel}
                    </Button>
                  ) : (
                    <Button variant="quiet" onClick={back}>
                      <ArrowLeft aria-hidden className="size-4" />
                      {w.back}
                    </Button>
                  )}
                  {step === 'review' ? (
                    <Button
                      className="ml-auto"
                      disabled={blocked || subjectsData.isPending}
                      onClick={() => go(rules.seed ?? 1)}
                    >
                      <Sparkles aria-hidden className="size-4" />
                      {g.button}
                    </Button>
                  ) : (
                    <Button
                      className="ml-auto"
                      disabled={saveDay.isPending || (step === 'day' && !scheduleReady(schedule))}
                      onClick={next}
                    >
                      {step === 'day' && dayChanged ? w.saveAndNext : w.next}
                      <ArrowRight aria-hidden className="size-4" />
                    </Button>
                  )}
                </>
              )}
              {stage === 'placed' && (
                <>
                  <Button
                    variant="secondary"
                    disabled={publish.isPending}
                    onClick={() => onDone(g.done(placedCount ?? 0))}
                  >
                    {w.seeWeek}
                  </Button>
                  <label className="ml-auto flex items-center gap-2 text-caption text-ink-muted">
                    {w.publishFrom}
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                      className="h-10 rounded-lg border border-line-strong bg-surface px-3 text-body text-ink"
                    />
                  </label>
                  <Button disabled={publish.isPending || !from} onClick={() => publish.mutate()}>
                    <Send aria-hidden className="size-4" />
                    {w.publish}
                  </Button>
                </>
              )}
              {stage === 'working' && (
                <p className="text-caption text-ink-muted">{g.workingBody}</p>
              )}
              {stage === 'result' && result && (
                <>
                  <Button
                    variant="quiet"
                    disabled={place.isPending}
                    onClick={() => setBackToSetup(true)}
                  >
                    <ArrowLeft aria-hidden className="size-4" />
                    {g.back}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={place.isPending}
                    onClick={() => go((rules.seed ?? 1) + 1)}
                  >
                    <RefreshCw aria-hidden className="size-4" />
                    {g.again}
                  </Button>
                  <Button
                    className="ml-auto"
                    disabled={place.isPending || result.placed.length === 0 || !!run.data?.stale}
                    onClick={() => place.mutate()}
                  >
                    <Check aria-hidden className="size-4" />
                    {g.action(result.placed.length)}
                  </Button>
                </>
              )}
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The search's stages, ticked off in turn while the worker runs. */
function Working() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, g.steps.length - 1)), 700);
    return () => clearInterval(id);
  }, []);
  return (
    <div role="status" className="mx-auto flex max-w-md flex-col gap-4 py-8">
      <p className="font-display text-lead font-semibold text-ink">{g.working}</p>
      <ol className="flex flex-col gap-2">
        {g.steps.map((s, i) => (
          <li
            key={s}
            className={cx(
              'flex items-center gap-3 text-body',
              i <= step ? 'text-ink' : 'text-ink-muted',
            )}
          >
            <span
              aria-hidden
              className={cx(
                'flex size-6 items-center justify-center rounded-full text-caption',
                i < step
                  ? 'bg-signal-go-tint text-signal-go-ink'
                  : i === step
                    ? 'bg-navy-950 text-white motion-safe:animate-pulse'
                    : 'bg-navy-50',
              )}
            >
              {i < step ? <Check className="size-3.5" /> : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Result({
  detail,
  result,
  colour,
  name,
  existing,
}: {
  detail: TimetableDetail;
  result: NonNullable<Generation['result']>;
  colour: Map<string, (typeof PALETTE)[number]>;
  name: Map<string, string>;
  existing: TimetableDetail['slots'];
}) {
  const { plan, periods, version } = detail;
  const withNew = plan.sections.filter((s) =>
    result.placed.some((p) => p.sectionId === s.sectionId),
  );
  const [sectionId, setSectionId] = useState(
    withNew[0]?.sectionId ?? plan.sections[0]?.sectionId ?? '',
  );
  const subject = new Map(plan.offerings.map((o) => [o.subjectId, o]));
  const sectionLabel = new Map(plan.sections.map((s) => [s.sectionId, s.label]));
  // In a rebuild only teaching-group lessons stay; in a fill every lesson does.
  const kept = existing.filter(
    (s) => s.sectionId === sectionId && (result.mode === 'fill' || s.groupId),
  );
  const fresh = result.placed.filter((p) => p.sectionId === sectionId);
  const at = (weekday: number, period: number) =>
    fresh.find((p) => p.weekday === weekday && p.period === period) ??
    kept.find((p) => p.weekday === weekday && p.period === period);
  const missing = result.short.reduce((n, x) => n + x.missing, 0);
  type WishLine = { label: string; met: number; of: number };
  const wishes = (
    [
      result.timeWish.of ? { label: g.wishLabels.time, ...result.timeWish } : null,
      result.classTeacherWish?.of
        ? { label: g.wishLabels.classTeacher, ...result.classTeacherWish }
        : null,
      result.samePeriodWish?.of
        ? { label: g.wishLabels.samePeriod, ...result.samePeriodWish }
        : null,
    ] as (WishLine | null)[]
  ).filter((x): x is WishLine => !!x);

  return (
    <div className="flex flex-col gap-5">
      <KeyFigures
        variant="strip"
        label={g.resultTitle}
        figures={[
          { label: g.placed, value: String(result.placed.length), tone: 'go' },
          { label: g.short, value: String(missing), tone: missing ? 'warn' : 'go' },
          { label: g.noTeacher, value: String(result.noTeacher) },
          ...(result.mode === 'rebuild' ? [{ label: g.kept, value: String(result.replaces) }] : []),
        ]}
      />
      {wishes.length > 0 && (
        <ul aria-label={g.wishes} className="grid gap-2 sm:grid-cols-3">
          {wishes.map((w) => (
            <li key={w.label} className="rounded-xl p-3 ring-1 ring-line">
              <p className="text-caption text-ink-muted">{w.label}</p>
              <p className="tabular font-display text-lead font-semibold text-ink">
                {g.wishOf(w.met, w.of)}
              </p>
              <span
                aria-hidden
                className="mt-2 block h-1.5 overflow-hidden rounded-full bg-navy-50"
              >
                <span
                  className="block h-full bg-navy-950"
                  style={{ width: `${(w.met / w.of) * 100}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-caption font-medium text-ink">
          {g.sectionPick}
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className={cx(fieldInput, 'h-9 w-auto')}
          >
            {plan.sections.map((s) => (
              <option key={s.sectionId} value={s.sectionId}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <span className="flex items-center gap-1.5 text-caption text-ink-muted">
          <Sparkles aria-hidden className="size-3.5" /> {g.newLesson}
        </span>
      </div>
      <div
        role="region"
        aria-label={sectionLabel.get(sectionId) ?? g.resultTitle}
        tabIndex={0}
        className="overflow-x-auto rounded-xl ring-1 ring-line"
      >
        <table className="w-full min-w-[720px] table-fixed border-collapse text-body">
          <caption className="sr-only">{sectionLabel.get(sectionId)}</caption>
          <thead>
            <tr className="bg-paper text-caption text-ink-muted">
              <th scope="col" className="w-24 px-3 py-2 text-left font-medium">
                <span className="sr-only">{t.periods}</span>
              </th>
              {version.days.map((d) => (
                <th key={d} scope="col" className="px-2 py-2 text-left font-medium">
                  {t.days[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) =>
              p.kind === 'break' ? (
                <tr key={p.number} className="bg-paper/60">
                  <th
                    scope="row"
                    className="px-3 py-1 text-left text-caption font-normal text-ink-muted"
                  >
                    {p.startsAt}
                  </th>
                  <td
                    colSpan={version.days.length}
                    className="px-2 py-1 text-center text-caption text-ink-muted"
                  >
                    {p.label ?? t.breakRow}
                  </td>
                </tr>
              ) : (
                <tr key={p.number} className="border-t border-line/60">
                  <th scope="row" className="px-3 py-2 text-left align-top">
                    <span className="block text-caption font-semibold text-ink">
                      {t.period(p.ordinal ?? p.number)}
                    </span>
                    <span className="tabular block text-caption text-ink-muted">{p.startsAt}</span>
                  </th>
                  {version.days.map((d) => {
                    const l = at(d, p.number);
                    const isNew = !!l && fresh.includes(l as (typeof fresh)[number]);
                    const c = l ? (colour.get(l.subjectId) ?? PALETTE[6]) : null;
                    return (
                      <td key={d} className="p-1 align-top">
                        {l && c ? (
                          <span
                            className={cx(
                              'relative block overflow-hidden rounded-md py-1 pr-1.5 pl-2.5',
                              c.cell,
                              !isNew && 'opacity-70',
                            )}
                          >
                            <span
                              aria-hidden
                              className={cx('absolute inset-y-0 left-0 w-1', c.bar)}
                            />
                            <span className="flex items-center gap-1 truncate text-caption font-semibold">
                              <span className="truncate">
                                {subject.get(l.subjectId)?.name ?? ''}
                              </span>
                              {isNew && (
                                <>
                                  <Sparkles aria-hidden className="ml-auto size-3 shrink-0" />
                                  <span className="sr-only">{g.newLesson}</span>
                                </>
                              )}
                            </span>
                            <span className="block truncate text-[0.6875rem]">
                              {[l.teacherPersonId ? name.get(l.teacherPersonId) : null, l.room]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          </span>
                        ) : (
                          <span className="block rounded-md border border-dashed border-line px-2 py-2 text-center text-caption text-ink-muted">
                            {g.free}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <section aria-labelledby="not-fitted" className="flex flex-col gap-2">
        <h3 id="not-fitted" className="text-body font-semibold text-ink">
          {g.notFitted}
        </h3>
        {result.short.length === 0 ? (
          <p className="text-body text-signal-go-ink">{g.allFitted}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-body text-ink">
            {result.short.map((x) => (
              <li key={`${x.sectionId}:${x.subjectId}`}>
                {g.shortRisk(
                  sectionLabel.get(x.sectionId) ?? '',
                  subject.get(x.subjectId)?.name ?? '',
                  x.missing,
                )}
              </li>
            ))}
          </ul>
        )}
        {result.mode === 'rebuild' && result.replaces > 0 && (
          <p className="text-caption text-ink-muted">{g.replaces(result.replaces)}</p>
        )}
        <p className="text-caption text-ink-muted">{g.undo}</p>
      </section>
    </div>
  );
}
