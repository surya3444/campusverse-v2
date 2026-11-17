'use client';

// Syllabus and lesson plans (docs/specs/SYLLABUS.md): plan each class's subject by month, tick
// units done per section, coverage against the plan, and lesson plans by week.
import type {
  ClassSubjects,
  CoverageRow,
  LessonPlan,
  SectionCoverage,
  UnitRow,
} from '@campusverse/school-syllabus';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  ListChecks,
  Plus,
  BookOpen,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInline, fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';

const t = en.syllabus;
type Tab = 'plan' | 'coverage' | 'lessons';
type Plan = { units: UnitRow[]; sections: SectionCoverage[]; canEdit: boolean; today: string };

const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const dayName = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** Monday of a date's week. */
const monday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return addDays(iso, -((d.getUTCDay() + 6) % 7));
};
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

function QueryState({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['syllabus-figures', 'syllabus-plan', 'syllabus-coverage', 'syllabus-lessons'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

/** Class and subject pickers over this year's classes; the person's own subjects first. */
function usePick(classes: ClassSubjects[] | undefined) {
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  useEffect(() => {
    if (!classes?.length || classId) return;
    const mine = classes.find((c) => c.subjects.some((s) => s.mine)) ?? classes[0];
    setClassId(mine?.classId ?? '');
    setSubjectId((mine?.subjects.find((s) => s.mine) ?? mine?.subjects[0])?.subjectId ?? '');
  }, [classes, classId]);
  const cls = classes?.find((c) => c.classId === classId);
  return {
    classId,
    subjectId,
    cls,
    setClass: (id: string) => {
      setClassId(id);
      const c = classes?.find((x) => x.classId === id);
      setSubjectId((c?.subjects.find((s) => s.mine) ?? c?.subjects[0])?.subjectId ?? '');
    },
    setSubjectId,
  };
}

function Pickers({
  classes,
  pick,
}: {
  classes: ClassSubjects[];
  pick: ReturnType<typeof usePick>;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.klass}</span>
        <select
          className={cx(fieldInline, 'min-w-40')}
          value={pick.classId}
          onChange={(e) => pick.setClass(e.target.value)}
        >
          {classes.map((c) => (
            <option key={c.classId} value={c.classId}>
              {c.className}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.subject}</span>
        <select
          className={cx(fieldInline, 'min-w-48')}
          value={pick.subjectId}
          onChange={(e) => pick.setSubjectId(e.target.value)}
        >
          {(pick.cls?.subjects ?? []).map((s) => (
            <option key={s.subjectId} value={s.subjectId}>
              {s.mine ? `${s.name} ${t.mine}` : s.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function SyllabusView() {
  const school = useInstitution();
  const id = school.institutionId;
  const [tab, setTab] = useState<Tab>('plan');
  const figures = useQuery({
    queryKey: ['syllabus-figures', id],
    queryFn: () =>
      api.get<{
        subjectsPlanned: number;
        units: number;
        averagePercent: number;
        sectionsBehind: number;
      }>(`/school/syllabus/figures?institutionId=${id}`),
    enabled: !!id,
  });
  const classes = useQuery({
    queryKey: ['syllabus-classes', id],
    queryFn: () => api.get<ClassSubjects[]>(`/school/syllabus/classes?institutionId=${id}`),
    enabled: !!id,
  });
  const f = figures.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ListChecks}
        art="exams"
        area="violet"
        eyebrow={en.nav.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          <Segmented
            label={t.tabsLabel}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'plan' as const, label: t.tabs.plan },
              { value: 'coverage' as const, label: t.tabs.coverage },
              { value: 'lessons' as const, label: t.tabs.lessons },
            ]}
          />
        }
      />
      {f && (
        <KeyFigures
          label={t.figures}
          figures={[
            { label: t.fig.subjects, icon: BookOpen, value: String(f.subjectsPlanned) },
            { label: t.fig.units, icon: ListChecks, value: String(f.units) },
            { label: t.fig.covered, icon: TrendingUp, value: `${f.averagePercent}%` },
            {
              label: t.fig.behind,
              icon: AlertTriangle,
              value: String(f.sectionsBehind),
              ...(f.sectionsBehind ? { tone: 'warn' as const } : {}),
            },
          ]}
        />
      )}
      {!id || !classes.data ? (
        <QueryState q={!id ? { isPending: true, error: null } : classes} />
      ) : classes.data.length === 0 ? (
        <EmptyState art="exams" area="violet" title={t.noYear} />
      ) : tab === 'plan' ? (
        <PlanTab institutionId={id} classes={classes.data} />
      ) : tab === 'coverage' ? (
        <CoverageTab institutionId={id} />
      ) : (
        <LessonsTab institutionId={id} classes={classes.data} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

function PlanTab({ institutionId, classes }: { institutionId: string; classes: ClassSubjects[] }) {
  const pick = usePick(classes);
  const { can } = useMe();
  const refresh = useRefresh();
  const [editing, setEditing] = useState<UnitRow | 'new' | null>(null);
  const [copying, setCopying] = useState(false);
  const q = useQuery({
    queryKey: ['syllabus-plan', institutionId, pick.classId, pick.subjectId],
    queryFn: () =>
      api.get<Plan>(
        `/school/syllabus/plan?institutionId=${institutionId}&classId=${pick.classId}&subjectId=${pick.subjectId}`,
      ),
    enabled: !!pick.classId && !!pick.subjectId,
  });
  const act = useMutation({
    mutationFn: (a: { path: string; body: Record<string, unknown> }) =>
      api.post(a.path, { institutionId, ...a.body }),
    onSuccess: refresh,
  });
  const p = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <Pickers classes={classes} pick={pick} />
        {can('school.syllabus.manage') && (
          <Button variant="secondary" onClick={() => setCopying(true)}>
            {t.copy}
          </Button>
        )}
      </div>
      {act.isError && (
        <p role="alert" className="text-caption text-signal-stop-ink">
          {errorText(act.error)}
        </p>
      )}
      {!p ? (
        <QueryState q={pick.classId ? q : { isPending: true, error: null }} />
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label={t.section}>
            {p.sections.map((s) => (
              <li key={s.sectionId} className="panel flex flex-col gap-1 p-4">
                <span className="flex items-center justify-between gap-2 text-body font-semibold text-ink">
                  {s.label}
                  <Pill tone={s.behind ? 'warn' : 'go'}>{s.behind ? t.behind : t.onTrack}</Pill>
                </span>
                <span className="text-caption text-ink-muted tabular-nums">
                  {t.sectionLine(s.done, s.total, s.percent)} · {t.expected(s.expected)}
                </span>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-navy-50" aria-hidden>
                  <div
                    className="h-full rounded-full bg-navy-950"
                    style={{ width: `${s.percent}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
          <Section
            id="syllabus-units"
            title={`${pick.cls?.className ?? ''} · ${pick.cls?.subjects.find((x) => x.subjectId === pick.subjectId)?.name ?? ''}`}
            flush
            actions={
              p.canEdit ? (
                <Button size="sm" onClick={() => setEditing('new')}>
                  <Plus aria-hidden className="size-4" />
                  {t.addUnit}
                </Button>
              ) : undefined
            }
          >
            {p.units.length === 0 ? (
              <EmptyState compact icon={ListChecks} title={t.noUnits} body={t.noUnitsBody} />
            ) : (
              <ol className="divide-y divide-line">
                {p.units.map((u, i) => (
                  <li key={u.unitId} className="flex flex-col gap-2 px-5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-caption font-semibold text-ink-muted tabular-nums">
                        {u.position}.
                      </span>
                      <span className="min-w-0 flex-1 text-body text-ink">
                        {u.title}
                        <span className="block text-caption text-ink-muted">
                          {[
                            u.plannedMonth ? t.month(u.plannedMonth) : null,
                            u.periods ? t.periodsCount(u.periods) : null,
                            u.notes || null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      {p.canEdit && (
                        <span className="flex gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={i === 0 || act.isPending}
                            aria-label={`${t.up}: ${u.title}`}
                            onClick={() =>
                              act.mutate({
                                path: `/school/syllabus/units/${u.unitId}/move`,
                                body: { direction: 'up' },
                              })
                            }
                          >
                            <ArrowUp aria-hidden className="size-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={i === p.units.length - 1 || act.isPending}
                            aria-label={`${t.down}: ${u.title}`}
                            onClick={() =>
                              act.mutate({
                                path: `/school/syllabus/units/${u.unitId}/move`,
                                body: { direction: 'down' },
                              })
                            }
                          >
                            <ArrowDown aria-hidden className="size-4" />
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditing(u)}>
                            {t.edit}
                            <span className="sr-only"> {u.title}</span>
                          </Button>
                          {!u.inUse && (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={act.isPending}
                              onClick={() =>
                                act.mutate({
                                  path: `/school/syllabus/units/${u.unitId}/delete`,
                                  body: {},
                                })
                              }
                            >
                              {t.remove}
                              <span className="sr-only"> {u.title}</span>
                            </Button>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 pl-6">
                      {p.sections.map((s) => {
                        const done = u.done.find((d) => d.sectionId === s.sectionId);
                        return (
                          <label
                            key={s.sectionId}
                            className={cx(
                              'inline-flex min-h-9 items-center gap-2 rounded-lg border px-2.5 text-caption',
                              done
                                ? 'border-signal-go bg-signal-go-tint text-signal-go-ink'
                                : 'border-line-strong text-ink',
                              !s.canTick && 'opacity-80',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={!!done}
                              disabled={!s.canTick || act.isPending}
                              onChange={(e) =>
                                act.mutate({
                                  path: `/school/syllabus/units/${u.unitId}/tick`,
                                  body: { sectionId: s.sectionId, done: e.target.checked },
                                })
                              }
                            />
                            {done ? t.doneOn(s.label, dmy(done.completedOn)) : t.tick(s.label)}
                          </label>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </>
      )}
      {editing && (
        <UnitForm
          institutionId={institutionId}
          classId={pick.classId}
          subjectId={pick.subjectId}
          unit={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {copying && (
        <CopyForm
          institutionId={institutionId}
          onClose={() => setCopying(false)}
          onDone={() => {
            setCopying(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function UnitForm({
  institutionId,
  classId,
  subjectId,
  unit,
  onClose,
  onDone,
}: {
  institutionId: string;
  classId: string;
  subjectId: string;
  unit: UnitRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(unit?.title ?? '');
  const [month, setMonth] = useState(unit?.plannedMonth?.slice(0, 7) ?? '');
  const [periods, setPeriods] = useState(unit?.periods ? String(unit.periods) : '');
  const [notes, setNotes] = useState(unit?.notes ?? '');
  const n = periods ? Number(periods) : null;
  const save = useMutation({
    mutationFn: () => {
      const body = {
        institutionId,
        classId,
        subjectId,
        title,
        plannedMonth: month || null,
        periods: n,
        notes,
      };
      return unit
        ? api.put(`/school/syllabus/units/${unit.unitId}`, body)
        : api.post('/school/syllabus/units', body);
    },
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={unit ? t.editUnit : t.addUnit}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!title.trim() || (n !== null && !(Number.isInteger(n) && n >= 1 && n <= 200))}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.unitTitle} wide>
        <input
          className={fieldInput}
          value={title}
          maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.plannedMonth} hint={t.optional}>
        <input
          type="month"
          className={fieldInput}
          value={month}
          onChange={(e) => setMonth(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.periods} hint={t.optional}>
        <input
          className={fieldInput}
          inputMode="numeric"
          value={periods}
          onChange={(e) => setPeriods(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.notes} hint={t.optional} wide>
        <input
          className={fieldInput}
          value={notes}
          maxLength={1000}
          onChange={(e) => setNotes(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function CopyForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const preview = useQuery({
    queryKey: ['syllabus-copy', institutionId],
    queryFn: () =>
      api.get<{ from: string | null; to: string; subjects: number; units: number }>(
        `/school/syllabus/copy?institutionId=${institutionId}`,
      ),
  });
  const commit = useMutation({
    mutationFn: () => api.post('/school/syllabus/copy', { institutionId }),
    onSuccess: onDone,
  });
  const p = preview.data;
  return (
    <FormModal
      title={t.copyTitle}
      submitLabel={t.copy}
      cancelLabel={t.cancel}
      pending={commit.isPending}
      submitDisabled={!p || p.subjects === 0}
      error={commit.error ? errorText(commit.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => commit.mutate()}
    >
      <div className="sm:col-span-2">
        {!p ? (
          <QueryState q={preview} />
        ) : p.subjects === 0 || !p.from ? (
          <p className="text-body text-ink">{t.copyNothing}</p>
        ) : (
          <p className="text-body text-ink">{t.copyLine(p.subjects, p.units, p.from, p.to)}</p>
        )}
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------

function CoverageTab({ institutionId }: { institutionId: string }) {
  const q = useQuery({
    queryKey: ['syllabus-coverage', institutionId],
    queryFn: () =>
      api.get<{ today: string; rows: CoverageRow[] }>(
        `/school/syllabus/coverage?institutionId=${institutionId}`,
      ),
  });
  if (!q.data) return <QueryState q={q} />;
  if (q.data.rows.length === 0)
    return <EmptyState icon={ListChecks} area="violet" title={t.noCoverage} />;
  return (
    <Section id="syllabus-coverage" title={t.tabs.coverage} flush>
      <ul className="divide-y divide-line">
        {q.data.rows.map((r) => (
          <li
            key={`${r.classId}-${r.subjectId}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
          >
            <span className="flex min-w-48 flex-1 flex-col">
              <span className="text-body text-ink">
                {r.className} · {r.subject}
              </span>
              <span className="text-caption text-ink-muted tabular-nums">
                {r.units} units · {t.expected(r.expected)}
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              {r.sections.map((s) => (
                <Pill key={s.sectionId} tone={s.behind ? 'warn' : 'go'}>
                  {`${s.label} ${s.percent}%${s.behind ? ` · ${t.behind}` : ''}`}
                </Pill>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Lesson plans
// ---------------------------------------------------------------------------------------------

function LessonsTab({
  institutionId,
  classes,
}: {
  institutionId: string;
  classes: ClassSubjects[];
}) {
  const pick = usePick(classes);
  const refresh = useRefresh();
  const [week, setWeek] = useState(monday(todayIso()));
  const [sectionId, setSectionId] = useState('');
  const [writing, setWriting] = useState<{ day: string; plan: LessonPlan | null } | null>(null);
  const plan = useQuery({
    queryKey: ['syllabus-plan', institutionId, pick.classId, pick.subjectId],
    queryFn: () =>
      api.get<Plan>(
        `/school/syllabus/plan?institutionId=${institutionId}&classId=${pick.classId}&subjectId=${pick.subjectId}`,
      ),
    enabled: !!pick.classId && !!pick.subjectId,
  });
  const sections = plan.data?.sections ?? [];
  const sid = sections.some((s) => s.sectionId === sectionId)
    ? sectionId
    : (sections[0]?.sectionId ?? '');
  const days = Array.from({ length: 6 }, (_, i) => addDays(week, i));
  const q = useQuery({
    queryKey: ['syllabus-lessons', institutionId, sid, pick.subjectId, week],
    queryFn: () =>
      api.get<LessonPlan[]>(
        `/school/syllabus/lesson-plans?institutionId=${institutionId}&sectionId=${sid}&subjectId=${pick.subjectId}&from=${days[0]}&to=${days[5]}`,
      ),
    enabled: !!sid && !!pick.subjectId,
  });
  const canWrite = sections.find((s) => s.sectionId === sid)?.canTick ?? false;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Pickers classes={classes} pick={pick} />
        {sections.length > 1 && (
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.section}</span>
            <select
              className={fieldInline}
              value={sid}
              onChange={(e) => setSectionId(e.target.value)}
            >
              {sections.map((s) => (
                <option key={s.sectionId} value={s.sectionId}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.week}</span>
          <input
            type="date"
            className={fieldInline}
            value={week}
            onChange={(e) => e.target.value && setWeek(monday(e.target.value))}
          />
        </label>
      </div>
      <Section id="syllabus-lessons" title={t.tabs.lessons} description={t.lessonsLead} flush>
        {!q.data ? (
          <div className="p-5">
            <QueryState q={sid ? q : plan} />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {days.map((d) => {
              const lp = q.data.find((x) => x.onDate === d) ?? null;
              const editable = lp ? lp.editable : d >= addDays(todayIso(), -1);
              return (
                <li key={d} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-3">
                  <span className="w-40 shrink-0 text-caption font-medium text-ink">
                    {dayName(d)}
                  </span>
                  <span className="min-w-0 flex-1 text-body whitespace-pre-line text-ink">
                    {lp ? (
                      <>
                        {lp.unit && (
                          <span className="block text-caption text-ink-muted">{lp.unit}</span>
                        )}
                        {lp.plan}
                        {lp.writtenBy && (
                          <span className="block text-caption text-ink-muted">
                            {t.by(lp.writtenBy)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-ink-muted">{t.noPlan}</span>
                    )}
                  </span>
                  {canWrite && editable && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setWriting({ day: d, plan: lp })}
                    >
                      {lp ? t.editPlan : t.writePlan}
                      <span className="sr-only"> {dayName(d)}</span>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      {writing && (
        <LessonForm
          institutionId={institutionId}
          sectionId={sid}
          subjectId={pick.subjectId}
          day={writing.day}
          existing={writing.plan}
          units={plan.data?.units ?? []}
          onClose={() => setWriting(null)}
          onDone={() => {
            setWriting(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function LessonForm({
  institutionId,
  sectionId,
  subjectId,
  day,
  existing,
  units,
  onClose,
  onDone,
}: {
  institutionId: string;
  sectionId: string;
  subjectId: string;
  day: string;
  existing: LessonPlan | null;
  units: UnitRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [unitId, setUnitId] = useState(existing?.unitId ?? '');
  const [text, setText] = useState(existing?.plan ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.put('/school/syllabus/lesson-plans', {
        institutionId,
        sectionId,
        subjectId,
        onDate: day,
        unitId: unitId || null,
        plan: text,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.planFor(dayName(day))}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!text.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.unit} wide>
        <select className={fieldInput} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          <option value="">{t.noUnit}</option>
          {units.map((u) => (
            <option key={u.unitId} value={u.unitId}>
              {`${u.position}. ${u.title}`}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.plan} hint={t.planHint} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={6}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}
