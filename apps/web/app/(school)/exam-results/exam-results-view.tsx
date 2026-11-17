'use client';

// Academics › Exams & Results for colleges and universities (rule book §13.2; P0 item 12): marks
// by course for a batch's current term, locks, results with SGPA and CGPA on the UGC 10-point
// scale, published with a second person's approval, and each student's grade card.
import type { ExamBoard, GradeCard, MarksSheet } from '@campusverse/academics-exams';
import type { StructureOverview } from '@campusverse/academics-structure';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  RecordDrawer,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookCheck, CheckCircle2, ClipboardList, Lock, Printer, Users } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { HallTickets } from './hall-tickets';
import { Reexams, useRequestReexam } from './reexams';

const t = en.examResults;
const a = en.academics;
const dash = '—';
const gpa = (n: number | null) => (n === null ? dash : n.toFixed(2));
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function ExamResultsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  const manage = can('academics.exam.manage');
  const marksRole = can('academics.exam.marks') || manage;
  const [chosen, setChosen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const [card, setCard] = useState<{ studentId: string; name: string } | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const overview = useQuery({
    queryKey: ['academics', id],
    queryFn: () => api.get<StructureOverview>(`/academics/structure?institutionId=${id}`),
    enabled: !!id,
  });
  const batches = overview.data?.batches.filter((b) => b.status === 'running') ?? [];
  const batchId = batches.find((b) => b.id === chosen)?.id ?? batches[0]?.id;
  const key = ['exam-board', batchId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<ExamBoard>(`/academics/batches/${batchId}/exams`),
    enabled: !!batchId,
  });
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const lock = useMutation({
    mutationFn: (v: { courseId: string; locked: boolean }) =>
      api.post(`/academics/batches/${batchId}/exams/courses/${v.courseId}/lock`, {
        locked: v.locked,
      }),
    onSettled: refresh,
  });
  const send = useMutation({
    mutationFn: () => api.post(`/academics/batches/${batchId}/results`, {}),
    onSettled: refresh,
  });
  const publish = useMutation({
    mutationFn: (resultId: string) =>
      api.post(`/academics/results/${resultId}/decision`, { approve: true, note: null }),
    onSettled: refresh,
  });
  const d = q.data;
  const error = overview.error ?? q.error;
  const isSchool = overview.data?.profile === 'school';
  const kind = d ? (a.termKinds[d.batch.termKind] ?? d.batch.termKind) : '';
  const totalTakers = d?.courses.reduce((n, c) => n + c.students, 0) ?? 0;
  const totalEntered = d?.courses.reduce((n, c) => n + c.entered, 0) ?? 0;
  const result = d?.result && d.result.state !== 'rejected' ? d.result : null;
  const actionError = lock.error ?? send.error ?? publish.error;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BookCheck}
        area="violet"
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
      >
        {d && <Pill>{t.termChip(`${kind} ${d.batch.term}`)}</Pill>}
      </PageHeader>
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
          <StatePanel kind="error" title={t.errors.error ?? ''} />
        )
      ) : isSchool ? (
        <Section>
          <EmptyState
            icon={BookCheck}
            area="violet"
            title={t.schoolTitle}
            body={t.schoolBody}
            actions={
              <Link
                href="/exams"
                className="inline-flex h-10 items-center rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-950/90"
              >
                {t.openExams}
              </Link>
            }
          />
        </Section>
      ) : overview.data && batches.length === 0 ? (
        <Section>
          <EmptyState icon={BookCheck} area="violet" title={t.noBatches} body={t.noBatchesBody} />
        </Section>
      ) : !d ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : (
        <>
          <KeyFigures
            label={t.figures}
            figures={[
              { label: t.fig.courses, icon: ClipboardList, value: String(d.courses.length) },
              {
                label: t.fig.entered,
                icon: Users,
                value: totalTakers ? `${Math.round((totalEntered / totalTakers) * 100)}%` : dash,
              },
              {
                label: t.fig.locked,
                icon: Lock,
                value: `${d.courses.filter((c) => c.locked).length}/${d.courses.length}`,
              },
              {
                label: t.fig.result,
                icon: CheckCircle2,
                value: t.states[d.result?.state ?? 'none'] ?? '',
              },
            ]}
          />

          <Section
            id="exam-courses"
            title={t.courses}
            description={t.coursesLead(d.grading.ciePercent, 100 - d.grading.ciePercent)}
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-body">
                <caption className="sr-only">{t.courses}</caption>
                <thead>
                  <tr className="border-b border-line bg-paper text-left text-caption tracking-wide whitespace-nowrap text-ink-muted uppercase">
                    <th scope="col" className="px-5 py-2 font-medium">
                      {t.table.course}
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium">
                      {t.table.entered}
                    </th>
                    <th scope="col" className="px-5 py-2 font-medium">
                      {t.table.state}
                    </th>
                    <th scope="col" className="px-5 py-2 text-right font-medium">
                      {t.table.actions}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {d.courses.map((c) => (
                    <tr key={c.courseId}>
                      <th scope="row" className="px-5 py-3 text-left font-normal">
                        <span className="font-medium text-ink">{c.code}</span> · {c.title}
                        <span className="block text-caption text-ink-muted">
                          {a.kinds[c.kind]} · {a.credits(c.credits)}
                        </span>
                      </th>
                      <td className="tabular px-5 py-3 text-ink">
                        {c.entered} / {c.students}
                      </td>
                      <td className="px-5 py-3">
                        <Pill tone={c.locked ? 'go' : 'warn'}>
                          {c.locked ? t.lockedPill : t.entering}
                        </Pill>
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex flex-wrap justify-end gap-2">
                          {marksRole && (
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={c.locked ? t.viewFor(c.code) : t.enterFor(c.code)}
                              onClick={() => setSheet(c.courseId)}
                            >
                              {c.locked ? t.view : t.enter}
                            </Button>
                          )}
                          {manage && !result && (
                            <Button
                              size="sm"
                              variant="quiet"
                              aria-label={c.locked ? t.reopenFor(c.code) : t.lockFor(c.code)}
                              disabled={lock.isPending || (!c.locked && c.entered < c.students)}
                              onClick={() =>
                                lock.mutate({ courseId: c.courseId, locked: !c.locked })
                              }
                            >
                              {c.locked ? t.reopen : t.lock}
                            </Button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            id="exam-results"
            title={t.results}
            description={t.resultsLead}
            actions={
              <span className="flex flex-wrap items-center gap-2">
                <Pill
                  tone={
                    d.result?.state === 'published'
                      ? 'go'
                      : d.result?.state === 'pending'
                        ? 'warn'
                        : 'neutral'
                  }
                >
                  {t.states[d.result?.state ?? 'none']}
                </Pill>
                {manage && !result && (
                  <Button
                    size="sm"
                    disabled={!d.ready || send.isPending}
                    title={d.ready ? undefined : t.sendHint}
                    onClick={() => send.mutate()}
                  >
                    {t.send}
                  </Button>
                )}
                {result?.state === 'pending' && result.approval?.mine && (
                  <>
                    <Button
                      size="sm"
                      disabled={publish.isPending}
                      onClick={() => publish.mutate(result.id)}
                    >
                      {t.approve}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setSendingBack(true)}>
                      {t.sendBack}
                    </Button>
                  </>
                )}
              </span>
            }
            flush
          >
            {result?.state === 'pending' && result.approval?.status === 'pending' && (
              <p className="px-6 pb-3 text-caption text-ink-muted">
                {en.workflow.progress(
                  result.approval.step,
                  result.approval.steps,
                  result.approval.stepRoleName ?? en.workflow.anyApprover,
                )}
              </p>
            )}
            {d.result?.state === 'rejected' && d.result.decisionNote && (
              <p className="px-6 pb-3 text-caption text-signal-warn-ink">{d.result.decisionNote}</p>
            )}
            {d.students.length === 0 ? (
              <p className="px-6 py-5 text-body text-ink-muted">{t.noStudents}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-body">
                  <caption className="sr-only">{t.results}</caption>
                  <thead>
                    <tr className="border-b border-line bg-paper text-left text-caption tracking-wide whitespace-nowrap text-ink-muted uppercase">
                      <th scope="col" className="px-5 py-2 font-medium">
                        {t.rtable.student}
                      </th>
                      <th scope="col" className="px-5 py-2 font-medium">
                        {t.rtable.credits}
                      </th>
                      <th scope="col" className="px-5 py-2 text-right font-medium">
                        {t.rtable.sgpa}
                      </th>
                      <th scope="col" className="px-5 py-2 text-right font-medium">
                        {t.rtable.cgpa}
                      </th>
                      <th scope="col" className="px-5 py-2 font-medium">
                        {t.rtable.failed}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.students.map((s) => {
                      const failed = s.courses.filter((c) => !c.passed).map((c) => c.code);
                      return (
                        <tr key={s.studentId}>
                          <th scope="row" className="px-5 py-3 text-left font-normal">
                            <button
                              type="button"
                              onClick={() => setCard({ studentId: s.studentId, name: s.name })}
                              className="text-left font-medium text-navy-950 underline-offset-2 hover:underline"
                            >
                              {s.name}
                            </button>
                            {s.registerNumber && (
                              <span className="tabular block text-caption text-ink-muted">
                                {s.registerNumber}
                              </span>
                            )}
                          </th>
                          <td className="tabular px-5 py-3 text-ink">
                            {t.creditsOf(s.creditsEarned, s.credits)}
                          </td>
                          <td className="tabular px-5 py-3 text-right font-semibold text-ink">
                            {gpa(s.sgpa)}
                          </td>
                          <td className="tabular px-5 py-3 text-right text-ink">{gpa(s.cgpa)}</td>
                          <td className="px-5 py-3">
                            {failed.length ? (
                              <span className="flex flex-wrap gap-1">
                                {failed.map((f) => (
                                  <Pill key={f} tone="stop">
                                    {f}
                                  </Pill>
                                ))}
                              </span>
                            ) : (
                              dash
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          {actionError && (
            <p role="alert" className="text-caption text-signal-stop-ink">
              {errorText(actionError)}
            </p>
          )}
          {batchId && <HallTickets batchId={batchId} canManage={manage} />}
          {d.publishedTerms.length > 0 && batchId && (
            <Reexams batchId={batchId} termKind={kind} canManage={manage} canMark={marksRole} />
          )}
        </>
      )}
      {sheet && batchId && (
        <MarksForm
          batchId={batchId}
          courseId={sheet}
          onClose={() => setSheet(null)}
          onSaved={refresh}
        />
      )}
      {sendingBack && result && (
        <SendBackForm
          resultId={result.id}
          onClose={() => setSendingBack(false)}
          onDone={async () => (setSendingBack(false), await refresh())}
        />
      )}
      {d && batchId && (
        <CardDrawer
          batchId={batchId}
          student={card}
          termKind={kind}
          canManage={manage}
          preview={
            d.result?.state !== 'published'
              ? d.students.find((s) => s.studentId === card?.studentId)
              : undefined
          }
          onClose={() => setCard(null)}
        />
      )}
    </div>
  );
}

type Row = { cie: string; see: string; absent: boolean; scores: string[] };
const num = (v: string) => (v.trim() === '' ? null : Number(v));

function MarksForm({
  batchId,
  courseId,
  onClose,
  onSaved,
}: {
  batchId: string;
  courseId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const q = useQuery({
    queryKey: ['exam-sheet', batchId, courseId],
    queryFn: () => api.get<MarksSheet>(`/academics/batches/${batchId}/exams/courses/${courseId}`),
  });
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const s = q.data;
  const rowOf = (r: MarksSheet['rows'][number]): Row =>
    edits[r.personId] ?? {
      cie: r.cie === null ? '' : String(r.cie),
      see: r.see === null ? '' : String(r.see),
      absent: r.absent,
      scores: (r.scores ?? []).map((x) => (x === null ? '' : String(x))),
    };
  const plan = s?.components ?? null;
  /** The internal mark from component scores, as the server works it out (two decimals). */
  const cieOf = (v: Row) => {
    if (!plan || !s) return num(v.cie);
    const xs = plan.map((_, i) => num(v.scores[i] ?? ''));
    if (xs.some((x) => x === null || Number.isNaN(x))) return null;
    const share = plan.reduce((n, c, i) => n + (c.weight * (xs[i] ?? 0)) / c.maxMarks, 0) / 100;
    return Math.round(share * s.cieMax * 100) / 100;
  };
  const set = (id: string, base: Row, patch: Partial<Row>) =>
    setEdits({ ...edits, [id]: { ...base, ...patch } });
  const bad =
    !!s &&
    s.rows.some((r) => {
      const v = rowOf(r);
      const c = cieOf(v);
      const e = num(v.see);
      return (
        (plan?.some((p, i) => {
          const x = num(v.scores[i] ?? '');
          return x !== null && (Number.isNaN(x) || x < 0 || x > p.maxMarks);
        }) ??
          false) ||
        (c !== null && (Number.isNaN(c) || c < 0 || c > s.cieMax)) ||
        (!v.absent && e !== null && (Number.isNaN(e) || e < 0 || e > s.seeMax))
      );
    });
  const save = useMutation({
    mutationFn: () =>
      api.post(`/academics/batches/${batchId}/exams/courses/${courseId}`, {
        rows: (s?.rows ?? [])
          .filter((r) => edits[r.personId])
          .map((r) => {
            const v = rowOf(r);
            return {
              studentId: r.personId,
              cie: plan ? null : num(v.cie),
              see: v.absent ? null : num(v.see),
              absent: v.absent,
              ...(plan ? { scores: plan.map((_, i) => num(v.scores[i] ?? '')) } : {}),
            };
          }),
      }),
    onSuccess: () => {
      onSaved();
      onClose();
    },
  });
  const title = s ? t.marksTitle(s.course.code, s.course.title) : t.enter;
  return (
    <FormModal
      title={title}
      description={s?.locked ? t.lockedNote : undefined}
      size="xl"
      submitLabel={t.save}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!s || s.locked || bad || Object.keys(edits).length === 0}
      error={save.isError ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {!s ? (
        <div className="sm:col-span-2">
          <SkeletonRows rows={4} label={en.states.loading.title} />
        </div>
      ) : (
        <div className="overflow-x-auto sm:col-span-2">
          <table className="w-full min-w-[560px] text-body">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="border-b border-line text-left text-caption text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t.rtable.student}
                </th>
                {plan?.map((p) => (
                  <th key={p.name} scope="col" className="px-3 py-2 font-medium">
                    {t.component(p.name, p.maxMarks, p.weight)}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium">
                  {t.cie(s.cieMax)}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t.see(s.seeMax)}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t.absent}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {s.rows.map((r) => {
                const v = rowOf(r);
                return (
                  <tr key={r.personId}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal text-ink">
                      {r.name}
                      {r.registerNumber && (
                        <span className="tabular block text-caption text-ink-muted">
                          {r.registerNumber}
                        </span>
                      )}
                    </th>
                    {plan?.map((p, i) => (
                      <td key={p.name} className="px-3 py-2">
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={p.maxMarks}
                          step="0.25"
                          disabled={s.locked}
                          aria-label={t.componentFor(p.name, r.name)}
                          value={v.scores[i] ?? ''}
                          onChange={(e) =>
                            set(r.personId, v, {
                              scores: plan.map((_, j) =>
                                j === i ? e.target.value : (v.scores[j] ?? ''),
                              ),
                            })
                          }
                          className={`${fieldInput} tabular w-20`}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2">
                      {plan ? (
                        <output
                          aria-label={t.cieFor(r.name)}
                          className="tabular block w-16 text-ink"
                        >
                          {cieOf(v) ?? '—'}
                        </output>
                      ) : (
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={s.cieMax}
                          step="0.25"
                          disabled={s.locked}
                          aria-label={t.cieFor(r.name)}
                          value={v.cie}
                          onChange={(e) => set(r.personId, v, { cie: e.target.value })}
                          className={`${fieldInput} tabular w-24`}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        max={s.seeMax}
                        step="0.25"
                        disabled={s.locked || v.absent}
                        aria-label={t.seeFor(r.name)}
                        value={v.absent ? '' : v.see}
                        onChange={(e) => set(r.personId, v, { see: e.target.value })}
                        className={`${fieldInput} tabular w-24`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={s.locked}
                        aria-label={t.absentFor(r.name)}
                        checked={v.absent}
                        onChange={(e) => set(r.personId, v, { absent: e.target.checked })}
                        className="size-4 accent-navy-950"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </FormModal>
  );
}

function SendBackForm({
  resultId,
  onClose,
  onDone,
}: {
  resultId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/academics/results/${resultId}/decision`, { approve: false, note }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.sendBackTitle}
      submitLabel={t.sendBack}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!note.trim()}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={t.why} wide>
        <textarea
          required
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

function CardDrawer({
  batchId,
  student,
  termKind,
  canManage,
  preview,
  onClose,
}: {
  batchId: string;
  student: { studentId: string; name: string } | null;
  termKind: string;
  canManage: boolean;
  preview: ExamBoard['students'][number] | undefined;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: ['grade-card', batchId, student?.studentId],
    queryFn: () =>
      api.get<GradeCard>(`/academics/batches/${batchId}/grade-card/${student?.studentId}`),
    enabled: !!student,
  });
  const c = q.data;
  const ask = useRequestReexam(batchId);
  return (
    <RecordDrawer
      open={!!student}
      onOpenChange={(o) => !o && onClose()}
      title={student ? t.cardFor(student.name) : t.card}
      {...(c ? { subtitle: `${c.batch}${c.registerNumber ? ` · ${c.registerNumber}` : ''}` } : {})}
      closeLabel={en.form.close}
    >
      {!c ? (
        q.error ? (
          <StatePanel kind="error" title={errorText(q.error)} />
        ) : (
          <SkeletonRows rows={4} label={en.states.loading.title} />
        )
      ) : (
        <div className="flex flex-col gap-5">
          {preview && preview.courses.length > 0 && (
            <p className="rounded-lg bg-signal-warn-tint px-3 py-2 text-caption text-signal-warn-ink">
              {t.preview}
            </p>
          )}
          {[
            ...c.terms,
            ...(preview && preview.courses.length > 0
              ? [{ term: 0, ...preview, publishedAt: '' }]
              : []),
          ].map((term) => (
            <section
              key={term.term}
              aria-label={term.term ? t.term(termKind, term.term) : t.preview}
              className="flex flex-col gap-2"
            >
              {term.term > 0 && (
                <h3 className="font-display text-body font-semibold text-ink">
                  {t.term(termKind, term.term)}
                </h3>
              )}
              <table className="w-full text-caption">
                <thead>
                  <tr className="border-b border-line text-left text-ink-muted">
                    <th scope="col" className="py-1 pr-2 font-medium">
                      {t.gradeCols.course}
                    </th>
                    <th scope="col" className="px-1 py-1 text-right font-medium">
                      {t.gradeCols.credits}
                    </th>
                    <th scope="col" className="px-1 py-1 text-right font-medium">
                      {t.gradeCols.total}
                    </th>
                    <th scope="col" className="px-1 py-1 text-right font-medium">
                      {t.gradeCols.grade}
                    </th>
                    {canManage && term.term > 0 && (
                      <th scope="col" className="py-1 pl-2 print:hidden">
                        <span className="sr-only">{t.reexams.title}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {term.courses.map((x) => (
                    <tr key={x.courseId}>
                      <th scope="row" className="py-1 pr-2 text-left font-normal text-ink">
                        {x.code} · {x.title}
                      </th>
                      <td className="tabular px-1 py-1 text-right text-ink">{x.credits}</td>
                      <td className="tabular px-1 py-1 text-right text-ink">
                        {x.absent ? t.absentShort : x.total}
                      </td>
                      <td className="px-1 py-1 text-right font-semibold text-ink">{x.grade}</td>
                      {canManage && term.term > 0 && (
                        <td className="py-1 pl-2 text-right print:hidden">
                          {!x.absent && student && (
                            <Button
                              size="sm"
                              variant="quiet"
                              aria-label={t.reexams.registerFor(
                                t.reexams.revaluation,
                                student.name,
                                x.code,
                              )}
                              disabled={ask.isPending}
                              onClick={() =>
                                ask.mutate({
                                  term: term.term,
                                  studentId: student.studentId,
                                  courseId: x.courseId,
                                  kind: 'revaluation',
                                })
                              }
                            >
                              {t.reexams.revaluation}
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="tabular text-caption text-ink">
                {t.sgpaLine(gpa(term.sgpa), gpa(term.cgpa), term.creditsEarned, term.credits)}
              </p>
            </section>
          ))}
          {ask.isSuccess && (
            <p role="status" className="text-caption text-signal-go-ink">
              {t.reexams.registered}
            </p>
          )}
          {ask.error && (
            <p role="alert" className="text-caption text-signal-stop-ink">
              {errorText(ask.error)}
            </p>
          )}
          {c.terms.length === 0 && !(preview && preview.courses.length > 0) && (
            <p className="text-body text-ink-muted">{t.noCard}</p>
          )}
          <Button variant="secondary" onClick={() => window.print()} className="self-start">
            <Printer aria-hidden className="size-4" />
            {t.print}
          </Button>
        </div>
      )}
    </RecordDrawer>
  );
}
