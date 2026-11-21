'use client';

// The generator's first questions, asked on the timetable screen itself (owner's brief, 21 Nov
// 2026): which subjects each class takes and how many periods a week, who teaches each subject
// to each section, and whether it all fits, before anything is generated. Subjects, periods and
// teachers are saved where Subjects keeps them (school setup), so both screens always agree.
import type { SubjectsOverview } from '@campusverse/school-setup';
import { Button, Pill, Segmented, cx, type Tone } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Minus, Plus, XCircle } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { fieldInput } from '../common/custom-fields';
import { t } from './shared';

const w = t.wizard;

export function useSubjects(institutionId: string) {
  return useQuery({
    queryKey: ['setup-subjects', institutionId],
    queryFn: () => api.get<SubjectsOverview>(`/school/setup/${institutionId}/subjects`),
  });
}

const failText = (e: unknown) =>
  e instanceof ApiFailure && e.status === 403
    ? w.noRight
    : e instanceof ApiFailure
      ? (w.errors[e.code] ?? w.errors.error)
      : w.errors.error;

/** Saves to school setup, then refreshes Subjects and the timetable's plan. */
function useSetup(institutionId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api.post(`/school/setup/${institutionId}/${path}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['setup-subjects', institutionId] });
      void qc.invalidateQueries({ queryKey: ['timetable'] });
    },
  });
}

/** One class at a time: a segmented row for a few, a picker for many. */
function ClassPicker({
  classes,
  value,
  onChange,
}: {
  classes: SubjectsOverview['classes'];
  value: string;
  onChange: (id: string) => void;
}) {
  if (classes.length <= 6)
    return (
      <Segmented
        label={w.classLabel}
        value={value}
        onChange={onChange}
        options={classes.map((c) => ({ value: c.classId, label: c.name }))}
      />
    );
  return (
    <label className="flex items-center gap-2 text-caption text-ink-muted">
      {w.classLabel}
      <select
        className="h-9 rounded-lg border border-line bg-surface px-2 text-body text-ink"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {classes.map((c) => (
          <option key={c.classId} value={c.classId}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** How full a class's week is: planned periods against the periods the week has. */
function WeekMeter({ planned, capacity }: { planned: number; capacity: number }) {
  const over = planned > capacity;
  const tone = over ? 'bg-signal-stop' : planned === capacity ? 'bg-signal-go' : 'bg-navy-950';
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="font-medium text-ink">{w.weekFill}</span>
        <span
          className={cx('tabular', over ? 'font-semibold text-signal-stop-ink' : 'text-ink-muted')}
        >
          {w.planned(planned, capacity)}
        </span>
      </div>
      <span
        role="meter"
        aria-label={w.weekFill}
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={planned}
        className="h-2 overflow-hidden rounded-full bg-navy-50"
      >
        <span
          className={cx('block h-full rounded-full', tone)}
          style={{ width: `${Math.min(100, (planned / Math.max(capacity, 1)) * 100)}%` }}
        />
      </span>
      {over && (
        <span className="text-caption text-signal-stop-ink">{w.overBy(planned - capacity)}</span>
      )}
    </div>
  );
}

const periodsOf = (c: SubjectsOverview['classes'][number]) =>
  c.offerings.reduce((a, o) => a + (o.periodsPerWeek ?? 0), 0);

/** Step 2: each class's subjects and how many periods a week. */
export function SubjectsStep({
  institutionId,
  overview,
  capacity,
}: {
  institutionId: string;
  overview: SubjectsOverview;
  capacity: number;
}) {
  const classes = overview.classes.filter((c) => c.sections.length > 0);
  const [classId, setClassId] = useState(classes[0]?.classId ?? '');
  const cls = classes.find((c) => c.classId === classId) ?? classes[0];
  const save = useSetup(institutionId);
  const qc = useQueryClient();
  const [adding, setAdding] = useState({ code: '', name: '' });
  const add = useMutation({
    mutationFn: async () => {
      const { subjectId } = await api.post<{ subjectId: string }>(
        `/school/setup/${institutionId}/subjects`,
        { code: adding.code.trim().toUpperCase(), name: adding.name.trim(), kind: 'scholastic' },
      );
      if (cls)
        await api.post(`/school/setup/${institutionId}/offerings`, {
          classId: cls.classId,
          subjectId,
          offered: true,
          periodsPerWeek: 4,
        });
    },
    onSuccess: () => {
      setAdding({ code: '', name: '' });
      void qc.invalidateQueries({ queryKey: ['setup-subjects', institutionId] });
      void qc.invalidateQueries({ queryKey: ['timetable'] });
    },
  });
  if (!cls) return <p className="text-body text-ink-muted">{w.noClasses}</p>;
  const live = overview.subjects.filter((s) => !s.retired);
  const offering = (subjectId: string) => cls.offerings.find((o) => o.subjectId === subjectId);
  const setOffer = (subjectId: string, offered: boolean, periodsPerWeek: number | null) =>
    save.mutate({
      path: 'offerings',
      body: { classId: cls.classId, subjectId, offered, periodsPerWeek },
    });
  const failure = save.error ?? add.error;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-body text-ink">{w.subjectsLead}</p>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <ClassPicker classes={classes} value={cls.classId} onChange={setClassId} />
        <div className="min-w-64 flex-1 sm:max-w-sm">
          <WeekMeter planned={periodsOf(cls)} capacity={capacity} />
        </div>
      </div>
      {failure && (
        <p
          role="alert"
          className="rounded-lg bg-signal-stop-tint px-3 py-2 text-caption text-signal-stop-ink"
        >
          {failText(failure)}
        </p>
      )}
      <ul className="grid gap-2 md:grid-cols-2">
        {live.map((s) => {
          const o = offering(s.subjectId);
          const n = o?.periodsPerWeek ?? 0;
          return (
            <li
              key={s.subjectId}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1',
                o ? 'bg-surface ring-navy-200' : 'bg-paper ring-line',
              )}
            >
              <label className="flex min-w-0 flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  className="size-4 accent-[#04266d]"
                  checked={!!o}
                  disabled={save.isPending}
                  onChange={(e) =>
                    setOffer(s.subjectId, e.target.checked, e.target.checked ? 4 : null)
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-body font-medium text-ink">{s.name}</span>
                  <span className="block text-caption text-ink-muted">{s.code}</span>
                </span>
              </label>
              {o && (
                <span className="flex items-center gap-1.5">
                  <span className="sr-only">{w.periodsFor(s.name)}</span>
                  <button
                    type="button"
                    aria-label={w.fewer(s.name)}
                    disabled={n <= 0 || save.isPending}
                    onClick={() => setOffer(s.subjectId, true, Math.max(0, n - 1))}
                    className="flex size-8 items-center justify-center rounded-lg ring-1 ring-line hover:bg-navy-50 disabled:opacity-40"
                  >
                    <Minus aria-hidden className="size-3.5" />
                  </button>
                  <span className="tabular w-16 text-center text-body text-ink" aria-live="polite">
                    {w.perWeek(n)}
                  </span>
                  <button
                    type="button"
                    aria-label={w.more(s.name)}
                    disabled={n >= 20 || save.isPending}
                    onClick={() => setOffer(s.subjectId, true, n + 1)}
                    className="flex size-8 items-center justify-center rounded-lg ring-1 ring-line hover:bg-navy-50 disabled:opacity-40"
                  >
                    <Plus aria-hidden className="size-3.5" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="flex flex-wrap items-end gap-2 rounded-xl bg-paper p-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <label className="flex flex-col gap-1 text-caption text-ink-muted">
          {w.newCode}
          <input
            required
            pattern="[A-Za-z0-9]{2,8}"
            maxLength={8}
            className={cx(fieldInput, 'w-28 font-mono uppercase')}
            value={adding.code}
            onChange={(e) => setAdding((a) => ({ ...a, code: e.target.value }))}
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-caption text-ink-muted">
          {w.newName}
          <input
            required
            maxLength={80}
            className={fieldInput}
            value={adding.name}
            onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={add.isPending}>
          <Plus aria-hidden className="size-4" />
          {w.addSubject(cls.name)}
        </Button>
      </form>
    </div>
  );
}

type Load = Map<string, number>;
/** Each teacher's periods a week across every class: their sections' subjects' periods. */
export function teacherLoad(overview: SubjectsOverview): Load {
  const load: Load = new Map();
  for (const c of overview.classes)
    for (const s of c.sections)
      for (const a of s.teachers) {
        const n = c.offerings.find((o) => o.subjectId === a.subjectId)?.periodsPerWeek ?? 0;
        load.set(a.personId, (load.get(a.personId) ?? 0) + n);
      }
  return load;
}

/** Step 3: who teaches each subject to each section. */
export function TeachersStep({
  institutionId,
  overview,
  capacity,
  limits,
}: {
  institutionId: string;
  overview: SubjectsOverview;
  capacity: number;
  /** A teacher's own most periods a week, from the generator's teacher rules. */
  limits: Record<string, number | undefined>;
}) {
  const classes = overview.classes.filter((c) => c.sections.length > 0);
  const [classId, setClassId] = useState(classes[0]?.classId ?? '');
  const cls = classes.find((c) => c.classId === classId) ?? classes[0];
  const save = useSetup(institutionId);
  if (!cls) return <p className="text-body text-ink-muted">{w.noClasses}</p>;
  const name = new Map(overview.subjects.map((s) => [s.subjectId, s.name]));
  const offered = cls.offerings.filter((o) => (o.periodsPerWeek ?? 0) > 0);
  const load = teacherLoad(overview);
  const teacherOf = (sectionId: string, subjectId: string) =>
    cls.sections
      .find((s) => s.sectionId === sectionId)
      ?.teachers.find((a) => a.subjectId === subjectId)?.personId ?? '';
  const assign = (sectionId: string, subjectId: string, personId: string) =>
    save.mutate({ path: 'teachers', body: { sectionId, subjectId, personId: personId || null } });
  const busiest = overview.staff
    .map((s) => ({ ...s, n: load.get(s.personId) ?? 0, max: limits[s.personId] ?? capacity }))
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n / b.max - a.n / a.max);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-body text-ink">{w.teachersLead}</p>
        <ClassPicker classes={classes} value={cls.classId} onChange={setClassId} />
        {save.error && (
          <p
            role="alert"
            className="rounded-lg bg-signal-stop-tint px-3 py-2 text-caption text-signal-stop-ink"
          >
            {failText(save.error)}
          </p>
        )}
        {offered.length === 0 ? (
          <p className="rounded-xl bg-paper px-4 py-3 text-body text-ink-muted">
            {w.noSubjectsYet}
          </p>
        ) : (
          <div
            role="region"
            aria-label={w.teachersOf(cls.name)}
            tabIndex={0}
            className="overflow-x-auto rounded-xl ring-1 ring-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-950"
          >
            <table className="w-full min-w-[520px] text-body">
              <thead>
                <tr className="bg-paper text-left text-caption text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {w.subject}
                  </th>
                  {cls.sections.map((s) => (
                    <th key={s.sectionId} scope="col" className="px-3 py-2 font-medium">
                      {s.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {offered.map((o) => {
                  const first = teacherOf(cls.sections[0]?.sectionId ?? '', o.subjectId);
                  const allSame = cls.sections.every(
                    (s) => teacherOf(s.sectionId, o.subjectId) === first,
                  );
                  return (
                    <tr key={o.subjectId}>
                      <th
                        scope="row"
                        className="px-3 py-2 text-left align-top font-medium text-ink"
                      >
                        {name.get(o.subjectId)}
                        <span className="block text-caption font-normal text-ink-muted">
                          {w.perWeek(o.periodsPerWeek ?? 0)}
                        </span>
                        {cls.sections.length > 1 && first && !allSame && (
                          <button
                            type="button"
                            onClick={() =>
                              cls.sections.forEach((s) => assign(s.sectionId, o.subjectId, first))
                            }
                            className="mt-1 text-caption font-medium text-navy-950 underline"
                          >
                            {w.sameForAll}
                          </button>
                        )}
                      </th>
                      {cls.sections.map((s) => {
                        const v = teacherOf(s.sectionId, o.subjectId);
                        return (
                          <td key={s.sectionId} className="px-2 py-2 align-top">
                            <select
                              aria-label={w.teacherFor(name.get(o.subjectId) ?? '', s.label)}
                              value={v}
                              disabled={save.isPending}
                              onChange={(e) => assign(s.sectionId, o.subjectId, e.target.value)}
                              className={cx(
                                'h-9 w-full rounded-lg border bg-surface px-2 text-body text-ink',
                                v ? 'border-line' : 'border-signal-warn',
                              )}
                            >
                              <option value="">{w.nobody}</option>
                              {overview.staff.map((p) => (
                                <option key={p.personId} value={p.personId}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <aside aria-labelledby="teacher-load" className="flex flex-col gap-3 rounded-xl bg-paper p-4">
        <h3 id="teacher-load" className="text-body font-semibold text-ink">
          {w.load}
        </h3>
        <p className="text-caption text-ink-muted">{w.loadLead(capacity)}</p>
        {busiest.length === 0 ? (
          <p className="text-caption text-ink-muted">{w.noLoad}</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {busiest.map((s) => {
              const over = s.n > s.max;
              return (
                <li key={s.personId} className="flex flex-col gap-1">
                  <span className="flex items-baseline justify-between gap-2 text-caption">
                    <span className="truncate font-medium text-ink">{s.name}</span>
                    <span
                      className={cx(
                        'tabular',
                        over ? 'font-semibold text-signal-stop-ink' : 'text-ink-muted',
                      )}
                    >
                      {w.loadOf(s.n, s.max)}
                    </span>
                  </span>
                  <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-navy-50">
                    <span
                      className={cx(
                        'block h-full rounded-full',
                        over ? 'bg-signal-stop' : 'bg-navy-950',
                      )}
                      style={{ width: `${Math.min(100, (s.n / Math.max(s.max, 1)) * 100)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}

export type Check = { tone: Tone; text: string };

/** What stops the generator, and what it will work around, before it runs. */
export function readiness(
  overview: SubjectsOverview,
  capacity: number,
  limits: Record<string, number | undefined>,
): Check[] {
  const out: Check[] = [];
  const name = new Map(overview.subjects.map((s) => [s.subjectId, s.name]));
  const staff = new Map(overview.staff.map((s) => [s.personId, s.name]));
  const classes = overview.classes.filter((c) => c.sections.length > 0);
  if (capacity === 0) out.push({ tone: 'stop', text: w.check.noPeriods });
  if (classes.every((c) => periodsOf(c) === 0)) out.push({ tone: 'stop', text: w.check.nothing });
  for (const c of classes) {
    const n = periodsOf(c);
    if (n > capacity) out.push({ tone: 'stop', text: w.check.tooMany(c.name, n, capacity) });
    const unset = c.offerings.filter((o) => !o.periodsPerWeek).map((o) => name.get(o.subjectId));
    if (unset.length)
      out.push({ tone: 'warn', text: w.check.noPeriodsSet(c.name, unset.join(', ')) });
    for (const s of c.sections) {
      const missing = c.offerings
        .filter(
          (o) =>
            (o.periodsPerWeek ?? 0) > 0 && !s.teachers.some((a) => a.subjectId === o.subjectId),
        )
        .map((o) => name.get(o.subjectId));
      if (missing.length)
        out.push({ tone: 'warn', text: w.check.noTeacher(s.label, missing.join(', ')) });
    }
  }
  for (const [pid, n] of teacherLoad(overview)) {
    const max = limits[pid] ?? capacity;
    if (n > max) out.push({ tone: 'stop', text: w.check.overloaded(staff.get(pid) ?? '', n, max) });
  }
  return out;
}

/** Step 5: everything checked, then generate. */
export function ReviewStep({ checks }: { checks: Check[] }) {
  const stops = checks.filter((c) => c.tone === 'stop');
  const warns = checks.filter((c) => c.tone !== 'stop');
  return (
    <div className="flex flex-col gap-4">
      {stops.length === 0 ? (
        <p className="flex items-start gap-3 rounded-xl bg-signal-go-tint px-4 py-3 text-body text-signal-go-ink">
          <CheckCircle2 aria-hidden className="mt-0.5 size-5 shrink-0" />
          {warns.length ? w.check.readyWithNotes : w.check.ready}
        </p>
      ) : (
        <p className="flex items-start gap-3 rounded-xl bg-signal-stop-tint px-4 py-3 text-body text-signal-stop-ink">
          <XCircle aria-hidden className="mt-0.5 size-5 shrink-0" />
          {w.check.fixFirst}
        </p>
      )}
      {checks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {[...stops, ...warns].map((c) => (
            <li
              key={c.text}
              className="flex items-start gap-2.5 rounded-lg bg-paper px-3 py-2 text-body text-ink"
            >
              {c.tone === 'stop' ? (
                <XCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-signal-stop" />
              ) : (
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-signal-warn" />
              )}
              <span className="flex flex-col gap-0.5">
                <Pill tone={c.tone}>{c.tone === 'stop' ? w.check.mustFix : w.check.note}</Pill>
                {c.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
