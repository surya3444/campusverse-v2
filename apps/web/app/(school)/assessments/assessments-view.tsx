'use client';

// Academics › Assessments (rule book §13.2): the question bank tagged by Bloom level, difficulty
// and CO, and question papers set from it with their blueprint.
import type {
  Bloom,
  Difficulty,
  PaperDetail,
  PaperRow,
  QuestionKind,
  QuestionRow,
} from '@campusverse/shared-assessments';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  RecordDrawer,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUp, ListChecks, Plus, Printer } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { useUrlTab } from '../common/url-tab';
import { BLOOM, DIFFICULTIES, KINDS, errorText, t } from './common';

type Tab = 'bank' | 'papers';

export function AssessmentsView() {
  const { can } = useMe();
  const school = useInstitution();
  const id = school.institutionId ?? null;
  const [tab, setTab] = useUrlTab<Tab>(['bank', 'papers'], 'bank');
  const [modal, setModal] = useState<'question' | 'paper' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const allowed = can('assessment.bank.manage');
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ListChecks}
        area="navy"
        eyebrow={en.systems.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          allowed ? (
            <Button onClick={() => setModal(tab === 'bank' ? 'question' : 'paper')} disabled={!id}>
              <Plus aria-hidden />
              {tab === 'bank' ? t.addQuestion : t.newPaper}
            </Button>
          ) : undefined
        }
      >
        <Segmented
          label={t.tabsLabel}
          value={tab}
          onChange={setTab}
          options={(['bank', 'papers'] as const).map((v) => ({ value: v, label: t.tabs[v] }))}
        />
      </PageHeader>
      <Announcer message={note} />
      {!allowed ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
      ) : !id ? (
        <SkeletonRows label={t.title} />
      ) : tab === 'bank' ? (
        <Bank institutionId={id} onAdd={() => setModal('question')} />
      ) : (
        <Papers institutionId={id} onNew={() => setModal('paper')} />
      )}
      {modal === 'question' && id && (
        <QuestionForm
          institutionId={id}
          question={null}
          onClose={() => setModal(null)}
          onDone={(msg) => {
            setModal(null);
            setNote(msg);
          }}
        />
      )}
      {modal === 'paper' && id && (
        <PaperForm
          institutionId={id}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            setTab('papers');
            setNote(t.paper.created);
          }}
        />
      )}
    </div>
  );
}

function useSubjects(institutionId: string) {
  return useQuery({
    queryKey: ['assessment-subjects', institutionId],
    queryFn: () => api.get<string[]>(`/assessments/subjects?institutionId=${institutionId}`),
  });
}

function useQuestions(
  institutionId: string,
  f: { subject?: string; bloom?: string; difficulty?: string; search?: string },
) {
  const qs = new URLSearchParams({ institutionId });
  for (const [k, v] of Object.entries(f)) if (v) qs.set(k, v);
  return useQuery({
    queryKey: ['assessment-questions', institutionId, f],
    queryFn: () => api.get<QuestionRow[]>(`/assessments/questions?${qs.toString()}`),
  });
}

const Tags = ({ q }: { q: Pick<QuestionRow, 'marks' | 'difficulty' | 'bloom' | 'coCode'> }) => (
  <span className="flex flex-wrap gap-1.5">
    <Pill>{t.marks(q.marks)}</Pill>
    <Pill>{t.bloom[q.bloom]}</Pill>
    <Pill>{t.difficulty[q.difficulty]}</Pill>
    {q.coCode && <Pill>{q.coCode}</Pill>}
  </span>
);

// ---------------------------------------------------------------------------------------------
// Question bank
// ---------------------------------------------------------------------------------------------

function Filters({
  institutionId,
  f,
  set,
}: {
  institutionId: string;
  f: { subject: string; bloom: string; difficulty: string; search: string };
  set: (patch: Partial<typeof f>) => void;
}) {
  const subjects = useSubjects(institutionId);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">{t.search}</span>
        <input
          type="search"
          className={fieldInput}
          value={f.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">{t.filterSubject}</span>
        <select
          className={fieldInput}
          value={f.subject}
          onChange={(e) => set({ subject: e.target.value })}
        >
          <option value="">{t.allSubjects}</option>
          {(subjects.data ?? []).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">{t.filterBloom}</span>
        <select
          className={fieldInput}
          value={f.bloom}
          onChange={(e) => set({ bloom: e.target.value })}
        >
          <option value="">{t.allLevels}</option>
          {BLOOM.map((b) => (
            <option key={b} value={b}>
              {t.bloom[b]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-muted">{t.filterDifficulty}</span>
        <select
          className={fieldInput}
          value={f.difficulty}
          onChange={(e) => set({ difficulty: e.target.value })}
        >
          <option value="">{t.allDifficulties}</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {t.difficulty[d]}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Bank({ institutionId, onAdd }: { institutionId: string; onAdd: () => void }) {
  const [f, setF] = useState({ subject: '', bloom: '', difficulty: '', search: '' });
  const [editing, setEditing] = useState<QuestionRow | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const list = useQuestions(institutionId, f);
  const filtered = Object.values(f).some(Boolean);
  if (list.error) return <StatePanel kind="error" title={errorText(list.error)} />;
  if (!list.data) return <SkeletonRows label={t.tabs.bank} />;
  if (list.data.length === 0 && !filtered)
    return (
      <EmptyState
        icon={ListChecks}
        area="navy"
        title={t.noQuestions}
        body={t.noQuestionsBody}
        actions={
          <Button onClick={onAdd}>
            <Plus aria-hidden />
            {t.addQuestion}
          </Button>
        }
      />
    );
  return (
    <>
      <Announcer message={note} />
      <Section id="assessment-bank" title={t.tabs.bank} flush>
        <div className="border-b border-line px-5 py-4">
          <Filters institutionId={institutionId} f={f} set={(p) => setF((x) => ({ ...x, ...p }))} />
        </div>
        {list.data.length === 0 ? (
          <p className="px-5 py-4 text-body text-ink-muted">{t.noMatch}</p>
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((q) => (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => setEditing(q)}
                  className="flex w-full flex-col gap-1.5 px-5 py-3 text-left hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
                >
                  <span className="line-clamp-2 font-medium text-ink">{q.prompt}</span>
                  <span className="text-caption text-ink-muted">
                    {[q.subject, q.topic, t.kinds[q.kind], q.usedIn ? t.usedIn(q.usedIn) : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <Tags q={q} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {editing && (
        <QuestionForm
          institutionId={institutionId}
          question={editing}
          onClose={() => setEditing(null)}
          onDone={(msg) => {
            setEditing(null);
            setNote(msg);
          }}
        />
      )}
    </>
  );
}

function QuestionForm({
  institutionId,
  question,
  onClose,
  onDone,
}: {
  institutionId: string;
  question: QuestionRow | null;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const fm = t.form;
  const qc = useQueryClient();
  const subjects = useSubjects(institutionId);
  const [subject, setSubject] = useState(question?.subject ?? '');
  const [topic, setTopic] = useState(question?.topic ?? '');
  const [kind, setKind] = useState<QuestionKind>(question?.kind ?? 'mcq');
  const [prompt, setPrompt] = useState(question?.prompt ?? '');
  const [optionsText, setOptionsText] = useState((question?.options ?? []).join('\n'));
  const [answer, setAnswer] = useState(question?.answer ?? '');
  const [marks, setMarks] = useState(String(question?.marks ?? 1));
  const [difficulty, setDifficulty] = useState<Difficulty>(question?.difficulty ?? 'medium');
  const [bloom, setBloom] = useState<Bloom>(question?.bloom ?? 'understand');
  const [coCode, setCoCode] = useState(question?.coCode ?? '');
  const options = optionsText
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);
  const refresh = async () => {
    for (const k of ['assessment-questions', 'assessment-subjects'])
      await qc.invalidateQueries({ queryKey: [k] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = {
        institutionId,
        subject,
        topic: topic.trim() || null,
        kind,
        prompt,
        options: kind === 'mcq' ? options : [],
        answer: answer.trim() || null,
        marks: Number(marks),
        difficulty,
        bloom,
        coCode: coCode.trim() || null,
      };
      return question
        ? api.put(`/assessments/questions/${question.id}`, body)
        : api.post('/assessments/questions', body);
    },
    onSuccess: async () => {
      await refresh();
      onDone(fm.saved);
    },
  });
  const archive = useMutation({
    mutationFn: () => api.post(`/assessments/questions/${question?.id}/archive`, { institutionId }),
    onSuccess: async () => {
      await refresh();
      onDone(fm.archived);
    },
  });
  const mcqOk = kind !== 'mcq' || (options.length >= 2 && options.includes(answer.trim()));
  const marksOk = Number(marks) > 0 && Number(marks) <= 100;
  return (
    <FormModal
      title={question ? t.editQuestion : t.addQuestion}
      submitLabel={fm.save}
      cancelLabel={t.close}
      pending={save.isPending || archive.isPending}
      submitDisabled={subject.trim().length < 2 || prompt.trim().length < 3 || !mcqOk || !marksOk}
      error={save.error ? errorText(save.error) : archive.error ? errorText(archive.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={fm.subject}>
        <input
          className={fieldInput}
          list="assessment-subject-list"
          value={subject}
          maxLength={80}
          onChange={(e) => setSubject(e.target.value)}
        />
        <datalist id="assessment-subject-list">
          {(subjects.data ?? []).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </ModalField>
      <ModalField label={fm.topic}>
        <input
          className={fieldInput}
          value={topic}
          maxLength={120}
          onChange={(e) => setTopic(e.target.value)}
        />
      </ModalField>
      <ModalField label={fm.kind}>
        <select
          className={fieldInput}
          value={kind}
          onChange={(e) => setKind(e.target.value as QuestionKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={fm.marks}>
        <input
          className={cx(fieldInput, 'tabular')}
          type="number"
          min={0.25}
          max={100}
          step={0.25}
          value={marks}
          onChange={(e) => setMarks(e.target.value)}
        />
      </ModalField>
      <ModalField label={fm.prompt} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={4}
          maxLength={4000}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </ModalField>
      {kind === 'mcq' ? (
        <>
          <ModalField label={fm.options} hint={fm.optionsHint} wide>
            <textarea
              className={cx(fieldInput, 'h-auto py-2')}
              rows={4}
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
            />
          </ModalField>
          <ModalField label={fm.answer} wide>
            <select
              className={fieldInput}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
            >
              <option value="">{en.surveys.choose}</option>
              {options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </ModalField>
        </>
      ) : (
        <ModalField label={fm.modelAnswer} hint={fm.modelAnswerHint} wide>
          <textarea
            className={cx(fieldInput, 'h-auto py-2')}
            rows={3}
            maxLength={4000}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </ModalField>
      )}
      <ModalField label={fm.bloom}>
        <select
          className={fieldInput}
          value={bloom}
          onChange={(e) => setBloom(e.target.value as Bloom)}
        >
          {BLOOM.map((b) => (
            <option key={b} value={b}>
              {t.bloom[b]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={fm.difficulty}>
        <select
          className={fieldInput}
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value as Difficulty)}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {t.difficulty[d]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={fm.co} hint={fm.coHint}>
        <input
          className={fieldInput}
          value={coCode}
          maxLength={20}
          pattern="[A-Za-z0-9.\-]*"
          onChange={(e) => setCoCode(e.target.value)}
        />
      </ModalField>
      {question && (
        <div className="flex items-end sm:col-span-2">
          <Button
            size="sm"
            variant="quiet"
            disabled={archive.isPending}
            onClick={() => archive.mutate()}
          >
            {fm.archive}
          </Button>
        </div>
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Question papers
// ---------------------------------------------------------------------------------------------

function Papers({ institutionId, onNew }: { institutionId: string; onNew: () => void }) {
  const p = t.paper;
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['assessment-papers', institutionId],
    queryFn: () => api.get<PaperRow[]>(`/assessments/papers?institutionId=${institutionId}`),
  });
  if (q.error) return <StatePanel kind="error" title={errorText(q.error)} />;
  if (!q.data) return <SkeletonRows label={t.tabs.papers} />;
  return (
    <>
      {q.data.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          area="navy"
          title={p.none}
          body={p.noneBody}
          actions={
            <Button onClick={onNew}>
              <Plus aria-hidden />
              {t.newPaper}
            </Button>
          }
        />
      ) : (
        <Section id="assessment-papers" title={t.tabs.papers} flush>
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpen(r.id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{r.title}</span>
                    <span className="text-caption text-ink-muted">
                      {[r.subject, p.row(r.questions, r.marks)].join(' · ')}
                    </span>
                  </span>
                  <Pill tone={r.state === 'final' ? 'go' : 'warn'}>{p.states[r.state]}</Pill>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {open && (
        <PaperDrawer institutionId={institutionId} paperId={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function PaperForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const p = t.paper;
  const qc = useQueryClient();
  const subjects = useSubjects(institutionId);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [minutes, setMinutes] = useState('');
  const [instructions, setInstructions] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post('/assessments/papers', {
        institutionId,
        title,
        subject,
        minutes: minutes ? Number(minutes) : null,
        instructions: instructions.trim() || null,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['assessment-papers'] });
      onDone();
    },
  });
  return (
    <FormModal
      title={t.newPaper}
      submitLabel={p.create}
      cancelLabel={t.close}
      pending={save.isPending}
      submitDisabled={title.trim().length < 3 || subject.trim().length < 2}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={p.title} wide>
        <input
          className={fieldInput}
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
        />
      </ModalField>
      <ModalField label={p.subject}>
        <select className={fieldInput} value={subject} onChange={(e) => setSubject(e.target.value)}>
          <option value="">{en.surveys.choose}</option>
          {(subjects.data ?? []).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </ModalField>
      <ModalField label={p.minutes}>
        <input
          className={cx(fieldInput, 'tabular')}
          type="number"
          min={5}
          max={600}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
      </ModalField>
      <ModalField label={p.instructions} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={3}
          maxLength={2000}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function Bars({ title, rows }: { title: string; rows: { label: string; marks: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.marks));
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className="text-caption font-semibold text-ink-muted uppercase">{title}</h4>
      <dl className="flex flex-col gap-1">
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid grid-cols-[minmax(0,7rem)_1fr_3rem] items-center gap-2"
          >
            <dt className="truncate text-caption text-ink-muted">{r.label}</dt>
            <dd className="h-2 rounded-full bg-paper" aria-hidden>
              <span
                className="block h-2 rounded-full bg-navy-950"
                style={{ width: `${(r.marks / max) * 100}%` }}
              />
            </dd>
            <dd className="text-right text-caption text-ink tabular">{r.marks}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function PaperDrawer({
  institutionId,
  paperId,
  onClose,
}: {
  institutionId: string;
  paperId: string;
  onClose: () => void;
}) {
  const p = t.paper;
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['assessment-paper', paperId],
    queryFn: () =>
      api.get<PaperDetail>(`/assessments/papers/${paperId}?institutionId=${institutionId}`),
  });
  const refresh = async (msg: string) => {
    setNote(msg);
    for (const k of ['assessment-paper', 'assessment-papers', 'assessment-questions'])
      await qc.invalidateQueries({ queryKey: [k] });
  };
  const finalise = useMutation({
    mutationFn: () => api.post(`/assessments/papers/${paperId}/finalise`, { institutionId }),
    onSuccess: () => refresh(p.finalised),
  });
  const d = q.data;
  const b = d?.blueprint;
  const print = (key: boolean) =>
    `/assessments/papers/${paperId}?institutionId=${institutionId}${key ? '&key=1' : ''}`;
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={d?.title ?? t.title}
      {...(d ? { subtitle: [d.subject, p.states[d.state]].join(' · ') } : {})}
      closeLabel={t.close}
    >
      <Announcer message={note} />
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !d || !b ? (
        <SkeletonRows label={t.title} />
      ) : (
        <div className="flex flex-col gap-5">
          {finalise.error && <StatePanel kind="error" title={errorText(finalise.error)} />}
          <div className="flex flex-wrap gap-2">
            {d.state === 'draft' && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
                  {p.pick}
                </Button>
                <Button
                  size="sm"
                  onClick={() => finalise.mutate()}
                  disabled={finalise.isPending || d.items.length === 0}
                >
                  {p.finalise}
                </Button>
              </>
            )}
            {d.items.length > 0 && (
              <>
                <Link
                  href={print(false)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-caption font-medium text-navy-950 hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
                >
                  <Printer aria-hidden className="size-4" />
                  {p.print}
                </Link>
                <Link
                  href={print(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-caption font-medium text-navy-950 hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
                >
                  {p.printKey}
                </Link>
              </>
            )}
          </div>
          {d.state === 'draft' && <p className="text-caption text-ink-muted">{p.finaliseHint}</p>}
          <section
            aria-labelledby="paper-blueprint"
            className="flex flex-col gap-3 rounded-lg bg-paper/60 p-4"
          >
            <h3 id="paper-blueprint" className="font-display text-lead font-semibold text-ink">
              {p.blueprint}
            </h3>
            <p className="text-body text-ink tabular">
              {[p.row(b.questions, b.marks), p.higherOrder(b.higherOrder)].join(' · ')}
            </p>
            {b.noCo > 0 && b.questions > 0 && (
              <p className="text-caption text-ink-muted">{p.noCoCount(b.noCo)}</p>
            )}
            <Bars
              title={p.byBloom}
              rows={BLOOM.map((l) => ({ label: t.bloom[l], marks: b.bloom[l] }))}
            />
            <Bars
              title={p.byDifficulty}
              rows={DIFFICULTIES.map((l) => ({ label: t.difficulty[l], marks: b.difficulty[l] }))}
            />
            {b.co.length > 0 && (
              <Bars title={p.byCo} rows={b.co.map((c) => ({ label: c.code, marks: c.marks }))} />
            )}
          </section>
          {d.items.length === 0 ? (
            <p className="text-body text-ink-muted">{p.empty}</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {d.items.map((i) => (
                <li key={i.position} className="flex flex-col gap-1.5 py-3">
                  <span className="text-body text-ink">
                    {i.position + 1}. {i.prompt}
                  </span>
                  <Tags q={i} />
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {picking && d && (
        <PickForm
          institutionId={institutionId}
          paper={d}
          onClose={() => setPicking(false)}
          onDone={async () => {
            setPicking(false);
            await refresh(p.picked);
          }}
        />
      )}
    </RecordDrawer>
  );
}

function PickForm({
  institutionId,
  paper,
  onClose,
  onDone,
}: {
  institutionId: string;
  paper: PaperDetail;
  onClose: () => void;
  onDone: () => void;
}) {
  const p = t.paper;
  const bank = useQuestions(institutionId, { subject: paper.subject });
  const [chosen, setChosen] = useState<string[]>(paper.items.map((i) => i.questionId));
  // Questions already on the paper but since removed from the bank stay listed from the copy.
  const rows: Pick<QuestionRow, 'id' | 'prompt' | 'marks' | 'difficulty' | 'bloom' | 'coCode'>[] = [
    ...paper.items
      .filter((i) => !(bank.data ?? []).some((q) => q.id === i.questionId))
      .map((i) => ({ ...i, id: i.questionId })),
    ...(bank.data ?? []),
  ];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const marks = chosen.reduce((s, id) => s + (byId.get(id)?.marks ?? 0), 0);
  const toggle = (id: string) =>
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const up = (id: string) =>
    setChosen((c) => {
      const i = c.indexOf(id);
      if (i <= 0) return c;
      const n = [...c];
      [n[i - 1], n[i]] = [n[i] ?? '', n[i - 1] ?? ''];
      return n;
    });
  const save = useMutation({
    mutationFn: () =>
      api.put(`/assessments/papers/${paper.id}/questions`, { institutionId, questionIds: chosen }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={p.pickTitle(paper.title)}
      description={p.pickHint}
      submitLabel={p.savePick}
      cancelLabel={t.close}
      pending={save.isPending}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <p className="text-body font-medium text-ink tabular sm:col-span-2" aria-live="polite">
        {p.selected(chosen.length, Math.round(marks * 100) / 100)}
      </p>
      {bank.error ? (
        <div className="sm:col-span-2">
          <StatePanel kind="error" title={errorText(bank.error)} />
        </div>
      ) : !bank.data ? (
        <div className="sm:col-span-2">
          <SkeletonRows label={p.pick} />
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-line sm:col-span-2">
          {rows.map((q) => {
            const n = chosen.indexOf(q.id);
            return (
              <li key={q.id} className="flex items-start gap-3 py-2">
                <input
                  id={`pick-${q.id}`}
                  type="checkbox"
                  className="mt-1 size-4 accent-navy-950"
                  checked={n >= 0}
                  onChange={() => toggle(q.id)}
                />
                <label htmlFor={`pick-${q.id}`} className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-body text-ink">
                    {n >= 0 && <span className="tabular font-semibold">{n + 1}. </span>}
                    {q.prompt}
                  </span>
                  <Tags q={q} />
                </label>
                {n > 0 && (
                  <Button size="sm" variant="quiet" onClick={() => up(q.id)}>
                    <ArrowUp aria-hidden className="size-4" />
                    <span className="sr-only">{p.moveUp(n + 1)}</span>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </FormModal>
  );
}
