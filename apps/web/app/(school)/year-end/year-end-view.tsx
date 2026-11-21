'use client';

import type { Preview, RolloverSummary, Row, SectionPlanView } from '@campusverse/school-rollover';
import { Announcer, Button, PageHeader, PreviewCanvas, StatePanel, cx } from '@campusverse/ui';
import { CalendarRange } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { field, useYears, type YearsAndClasses } from '../exams/shared';
import { NextYearDialog } from './next-year-dialog';

const t = en.yearEnd;
const yearError = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? '';
const percent = (bp: number | null) => (bp === null ? '—' : (bp / 100).toFixed(2));
type Decided = Exclude<Row['outcome'], 'review'>;
type Choice = { outcome: Row['outcome']; nextSectionId: string | null; reason: string };

export function YearEndView() {
  const school = useInstitution();
  const id = school.institutionId;
  const ref = useYears(id);
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ['rollovers', id],
    queryFn: () => api.get<RolloverSummary[]>(`/school/rollover/${id}`),
    enabled: !!id,
  });
  const years = ref.data?.years ?? [];
  // The year to close out: the latest open year that has a year after it (usually the one just
  // ended, or the running one when the next is already set up), else the running year.
  const closing =
    [...years]
      .reverse()
      .find((y) => y.status !== 'closed' && years.some((n) => n.starts >= y.ends)) ??
    years.find((y) => y.status === 'active') ??
    years.at(-1);
  const [fromYearId, setFrom] = useState('');
  const from = fromYearId || closing?.yearId || '';
  const fromYear = years.find((y) => y.yearId === from);
  const later = years.filter((y) => fromYear && y.starts >= fromYear.ends);
  const [toYearId, setTo] = useState('');
  const to = toYearId || later[0]?.yearId || '';
  const [notice, setNotice] = useState('');
  const [proposing, setProposing] = useState(false);
  const undo = useMutation({
    mutationFn: (runId: string) => api.post(`/school/rollover/runs/${runId}/undo`, {}),
    onSuccess: () => {
      setNotice(t.undone);
      void qc.invalidateQueries({ queryKey: ['rollovers', id] });
      void qc.invalidateQueries({ queryKey: ['rollover-preview'] });
    },
  });

  if (school.isPending || ref.isPending || (runs.isPending && !!id))
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  const failed = runs.error ?? ref.error ?? school.error;
  if (failed)
    return failed instanceof ApiFailure && failed.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={yearError(failed)} />
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarRange}
        art="yearEnd"
        eyebrow={en.nav.groups.academics}
        area="navy"
        title={t.title}
        description={t.lead}
      />
      <div className="panel flex flex-wrap items-end gap-3 p-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.from}</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)} className={field}>
            {years.map((y) => (
              <option key={y.yearId} value={y.yearId}>
                {y.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.to}</span>
          <select
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={field}
            disabled={later.length === 0}
          >
            {later.map((y) => (
              <option key={y.yearId} value={y.yearId}>
                {y.label}
              </option>
            ))}
          </select>
        </label>
        {later.length === 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-signal-warn-tint px-3 py-2 text-caption text-signal-warn-ink">
            {t.needsNextYear}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setProposing(true)}
              aria-haspopup="dialog"
            >
              {t.setUpNextYear}
            </Button>
          </p>
        )}
        {proposing && id && (
          <NextYearDialog
            institutionId={id}
            onClose={() => setProposing(false)}
            onDone={(r) => {
              setProposing(false);
              setNotice(t.nextYearReady(r.label, r.sections));
              setTo('');
              void qc.invalidateQueries({ queryKey: ['exam-years', id] });
            }}
          />
        )}
      </div>

      {id && from && to && (
        <RolloverPreview
          key={`${from}:${to}`}
          institutionId={id}
          fromYearId={from}
          toYearId={to}
          classes={ref.data?.classes ?? []}
          onCommitted={() => {
            setNotice(t.committed);
            void qc.invalidateQueries({ queryKey: ['rollovers', id] });
          }}
        />
      )}

      {runs.data && runs.data.length > 0 && (
        <section aria-labelledby="runs" className="panel">
          <h2
            id="runs"
            className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink"
          >
            {t.history}
          </h2>
          <ul className="divide-y divide-line">
            {runs.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex-1 text-body text-ink">
                  {r.fromYear} → {r.toYear}
                  <span className="ml-2 text-caption text-ink-muted tabular-nums">
                    {r.students} · {t.states[r.state]}
                  </span>
                </span>
                {r.state === 'committed' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={undo.isPending}
                    onClick={() => undo.mutate(r.id)}
                  >
                    {t.undo}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {undo.isError && (
            <p role="alert" className="px-5 pb-3 text-caption text-signal-stop-ink">
              {yearError(undo.error)}
            </p>
          )}
        </section>
      )}
      {notice && <Announcer message={notice} />}
    </div>
  );
}

function RolloverPreview({
  institutionId,
  fromYearId,
  toYearId,
  classes,
  onCommitted,
}: {
  institutionId: string;
  fromYearId: string;
  toYearId: string;
  classes: YearsAndClasses['classes'];
  onCommitted: () => void;
}) {
  const span = { fromYearId, toYearId };
  const preview = useQuery({
    queryKey: ['rollover-preview', institutionId, fromYearId, toYearId],
    queryFn: () => api.post<Preview>(`/school/rollover/${institutionId}/preview`, span),
  });
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [planFor, setPlanFor] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const rows = preview.data?.rows ?? [];
  const choice = (r: Row): Choice =>
    choices[r.studentId] ?? { outcome: r.outcome, nextSectionId: r.nextSectionId, reason: '' };
  const changed = rows.filter((r) => {
    const c = choice(r);
    return c.outcome !== r.outcome || c.nextSectionId !== r.nextSectionId;
  });
  const commit = useMutation({
    mutationFn: () =>
      api.post(`/school/rollover/${institutionId}/commit`, {
        ...span,
        overrides: changed.map((r) => {
          const c = choice(r);
          return {
            studentId: r.studentId,
            outcome: c.outcome as Decided,
            reason: c.reason,
            nextSectionId: c.outcome === 'passed_out' ? null : c.nextSectionId,
          };
        }),
      }),
    onSuccess: () => {
      setConfirming(false);
      setChoices({});
      void preview.refetch();
      onCommitted();
    },
    onError: () => setConfirming(false),
  });

  if (preview.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (preview.isError)
    return (
      <StatePanel kind="error" title={en.states.error.title} body={yearError(preview.error)} />
    );
  const p = preview.data;
  const seq = new Map(classes.map((c) => [c.classId, c.sequence]));
  const targetClass = (r: Row, outcome: Row['outcome']) =>
    outcome === 'detained'
      ? r.classId
      : outcome === 'passed_out'
        ? null
        : (r.nextClassId ??
          classes.find((c) => c.sequence > (seq.get(r.classId) ?? Infinity))?.classId ??
          null);
  const final = rows.map((r) => choice(r).outcome);
  const count = (o: Row['outcome']) => final.filter((x) => x === o).length;
  const unpublished = p.checklist.find((c) => c.code === 'exams_unpublished')?.count ?? 0;
  const blocked = count('review') > 0 || changed.some((r) => choice(r).reason.trim().length < 3);
  const planClasses = [...new Set(rows.map((r) => r.nextClassId).filter((x) => x !== null))];
  const set = (r: Row, patch: Partial<Choice>) =>
    setChoices((c) => ({ ...c, [r.studentId]: { ...choice(r), ...patch } }));

  return (
    <>
      {unpublished > 0 && (
        <p className="rounded-md bg-signal-warn-tint px-4 py-2.5 text-caption text-signal-warn-ink">
          {t.unpublished(unpublished)}
        </p>
      )}
      {rows.length === 0 ? (
        <StatePanel kind="empty" title={en.states.empty.title} />
      ) : (
        <section aria-labelledby="preview" className="panel">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
            <h2 id="preview" className="flex-1 text-body font-semibold text-ink">
              {t.preview}
            </h2>
            {planClasses.map((c) => (
              <Button key={c} size="sm" variant="quiet" onClick={() => setPlanFor(c)}>
                {t.planner(classes.find((x) => x.classId === c)?.name ?? '')}
              </Button>
            ))}
          </div>
          <div tabIndex={0} role="region" aria-label={t.preview} className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="text-left text-caption text-ink-muted">
                  <th className="px-5 py-2 font-medium">{en.students.name}</th>
                  <th className="px-3 py-2 font-medium">%</th>
                  <th className="px-3 py-2 font-medium">{t.outcome}</th>
                  <th className="px-3 py-2 font-medium">{t.nextSection}</th>
                  <th className="px-3 py-2 font-medium">{t.reason}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => {
                  const c = choice(r);
                  const cls = targetClass(r, c.outcome);
                  const options = p.nextSections.filter((s) => s.classId === cls);
                  const isChanged = changed.includes(r);
                  return (
                    <tr
                      key={r.studentId}
                      className={cx(c.outcome === 'review' && 'bg-signal-warn-tint/40')}
                    >
                      <td className="px-5 py-2.5">
                        <span className="flex flex-col">
                          <span className="text-ink">{r.name}</span>
                          <span className="text-caption text-ink-muted">
                            {r.sectionLabel} · {t.basis[r.basis]}
                            {r.basis === 'below_pass' && ` ${r.belowPass.join(', ')}`}
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">{percent(r.lastPercentBp)}</td>
                      <td className="px-3 py-2.5">
                        <select
                          aria-label={`${t.outcome}: ${r.name}`}
                          value={c.outcome}
                          onChange={(e) => {
                            const outcome = e.target.value as Row['outcome'];
                            const next = targetClass(r, outcome);
                            set(r, {
                              outcome,
                              nextSectionId:
                                outcome === r.outcome
                                  ? r.nextSectionId
                                  : (p.nextSections.find((s) => s.classId === next)?.sectionId ??
                                    null),
                            });
                          }}
                          className={field}
                        >
                          {(['promoted', 'detained', 'passed_out', 'review'] as const).map((o) => (
                            <option key={o} value={o} disabled={o === 'review'}>
                              {t.outcomes[o]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2.5">
                        {cls && (
                          <select
                            aria-label={`${t.nextSection}: ${r.name}`}
                            value={c.nextSectionId ?? ''}
                            onChange={(e) => set(r, { nextSectionId: e.target.value || null })}
                            className={field}
                          >
                            {options.map((s) => (
                              <option key={s.sectionId} value={s.sectionId}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {isChanged && (
                          <input
                            aria-label={`${t.reason}: ${r.name}`}
                            required
                            minLength={3}
                            value={c.reason}
                            onChange={(e) => set(r, { reason: e.target.value })}
                            className={cx(field, 'w-full min-w-40')}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-3.5">
            {(blocked || commit.isError) && (
              <p role="alert" className="flex-1 text-caption text-signal-stop-ink">
                {commit.isError
                  ? yearError(commit.error)
                  : count('review') > 0
                    ? t.errors.review_pending
                    : t.errors.reason_required}
              </p>
            )}
            <Button onClick={() => setConfirming(true)} disabled={blocked}>
              {t.commit}
            </Button>
          </div>
        </section>
      )}

      {planFor && (
        <Planner
          key={planFor}
          institutionId={institutionId}
          span={span}
          classId={planFor}
          className={classes.find((x) => x.classId === planFor)?.name ?? ''}
          onSaved={() => void preview.refetch()}
          onClose={() => setPlanFor(null)}
        />
      )}

      <PreviewCanvas
        open={confirming}
        onOpenChange={setConfirming}
        title={t.commitTitle}
        actionLabel={t.commit}
        changes={[...t.commitChanges]}
        affected={(['promoted', 'detained', 'passed_out'] as const).map((o) => ({
          label: t.affected[o] ?? o,
          count: count(o),
        }))}
        risks={unpublished > 0 ? [t.unpublished(unpublished)] : []}
        undo={t.commitUndo}
        busy={commit.isPending}
        labels={en.preview}
        onConfirm={() => commit.mutate()}
      />
    </>
  );
}

function Planner({
  institutionId,
  span,
  classId,
  className,
  onSaved,
  onClose,
}: {
  institutionId: string;
  span: { fromYearId: string; toYearId: string };
  classId: string;
  className: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [regenerate, setRegenerate] = useState(0);
  const view = useQuery({
    queryKey: ['section-plan', institutionId, span, classId, regenerate],
    queryFn: () =>
      api.post<SectionPlanView>(`/school/rollover/${institutionId}/plan`, {
        ...span,
        classId,
        ...(regenerate > 0 ? { regenerate: true } : {}),
      }),
  });
  const [moves, setMoves] = useState<Record<string, string>>({});
  const plan = { ...view.data?.plan, ...moves };
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/rollover/${institutionId}/plan/save`, {
        ...span,
        classId,
        plan,
        keepApart: view.data?.keepApart ?? [],
      }),
    onSuccess: onSaved,
  });
  if (view.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (view.isError)
    return <StatePanel kind="error" title={en.states.error.title} body={yearError(view.error)} />;
  const v = view.data;
  const sizes = new Map(v.sections.map((s) => [s.sectionId, 0]));
  for (const pupil of v.pupils) {
    const s = plan[pupil.id];
    if (s) sizes.set(s, (sizes.get(s) ?? 0) + 1);
  }
  const shown = Object.keys(moves).length === 0 ? v.problems : [];

  return (
    <section aria-labelledby="planner" className="panel">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3.5">
        <h2 id="planner" className="flex-1 text-body font-semibold text-ink">
          {t.planner(className)}
        </h2>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setMoves({});
            setRegenerate((n) => n + 1);
          }}
        >
          {t.regenerate}
        </Button>
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {t.savePlan}
        </Button>
        <Button size="sm" variant="quiet" onClick={onClose}>
          {en.preview.close}
        </Button>
      </div>
      <ul className="flex flex-wrap gap-3 px-5 py-3">
        {v.sections.map((s) => {
          const b = v.balance.find((x) => x.sectionId === s.sectionId);
          const n = sizes.get(s.sectionId) ?? 0;
          return (
            <li
              key={s.sectionId}
              className={cx(
                'rounded-md border px-3 py-2 text-caption tabular-nums',
                n > s.capacity ? 'border-signal-stop text-signal-stop-ink' : 'border-line text-ink',
              )}
            >
              <span className="font-medium">{s.label}</span> · {t.size(n, s.capacity)}
              {b?.averageBp != null && ` · ${t.average(percent(b.averageBp))}`}
            </li>
          );
        })}
      </ul>
      {shown.map((x, i) => (
        <p key={i} className="px-5 pb-2 text-caption text-signal-warn-ink">
          {t.problems[x.code]}
        </p>
      ))}
      <ul className="divide-y divide-line border-t border-line">
        {v.pupils.map((pupil) => (
          <li key={pupil.id} className="flex flex-wrap items-center gap-3 px-5 py-2">
            <span className="flex-1 text-body text-ink">
              {pupil.name}
              <span className="ml-2 text-caption text-ink-muted">{pupil.fromSection}</span>
            </span>
            <select
              aria-label={`${en.yearEnd.nextSection}: ${pupil.name}`}
              value={plan[pupil.id] ?? ''}
              onChange={(e) => setMoves((m) => ({ ...m, [pupil.id]: e.target.value }))}
              className={field}
            >
              {v.sections.map((s) => (
                <option key={s.sectionId} value={s.sectionId}>
                  {s.label}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {(save.isSuccess || save.isError) && (
        <p
          role={save.isError ? 'alert' : 'status'}
          className={cx(
            'px-5 py-3 text-caption',
            save.isError ? 'text-signal-stop-ink' : 'text-signal-go-ink',
          )}
        >
          {save.isError ? yearError(save.error) : t.planSaved}
        </p>
      )}
    </section>
  );
}
