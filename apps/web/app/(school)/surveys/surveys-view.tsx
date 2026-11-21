'use client';

// Academics › Feedback & Surveys (rule book §13.4). Everyone answers the open surveys meant for
// them; coordinators build surveys from templates, open and close them, read weighted results and
// record the actions taken (the NAAC action-taken report).
import type {
  Answer,
  Audience,
  Question,
  SurveyKind,
  SurveyResults,
  SurveyRow,
  SurveyToAnswer,
} from '@campusverse/shared-surveys';
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
import { MessageSquareHeart, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { useUrlTab } from '../common/url-tab';

const t = en.surveys;
// Inlined: a value import from the module contract would pull server code into the browser.
const SURVEY_KINDS: SurveyKind[] = [
  'course',
  'faculty',
  'facility',
  'parent',
  'exit',
  'alumni',
  'employer',
  'other',
];
const AUDIENCES: Audience[] = ['staff', 'parents', 'students'];
type Tab = 'answer' | 'manage';
const errorText = (e: unknown) =>
  (e instanceof ApiFailure ? t.errors[e.code] : undefined) ?? t.errors.error ?? '';
const day = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${d}T00:00:00`),
  );
const isoDay = (offset = 0) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const stateTone = (s: SurveyRow['state']) =>
  s === 'open' ? ('go' as const) : s === 'draft' ? ('warn' as const) : ('neutral' as const);

export function SurveysView() {
  const { can } = useMe();
  const school = useInstitution();
  const id = school.institutionId ?? null;
  const manage = can('survey.form.manage');
  const tabs: Tab[] = manage ? ['answer', 'manage'] : ['answer'];
  const [tab, setTab] = useUrlTab<Tab>(['answer', 'manage'], 'answer');
  const shown: Tab = tabs.includes(tab) ? tab : 'answer';
  const [creating, setCreating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={MessageSquareHeart}
        area="navy"
        eyebrow={en.systems.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          manage ? (
            <Button onClick={() => setCreating(true)} disabled={!id}>
              <Plus aria-hidden />
              {t.newSurvey}
            </Button>
          ) : undefined
        }
      >
        {tabs.length > 1 && (
          <Segmented
            label={t.tabsLabel}
            value={shown}
            onChange={setTab}
            options={tabs.map((v) => ({ value: v, label: t.tabs[v] }))}
          />
        )}
      </PageHeader>
      <Announcer message={note} />
      {!id ? (
        <SkeletonRows label={t.title} />
      ) : shown === 'answer' ? (
        <ToAnswer institutionId={id} />
      ) : (
        <Manage institutionId={id} onNew={() => setCreating(true)} />
      )}
      {creating && id && (
        <CreateForm
          institutionId={id}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            setTab('manage');
            setNote(t.form.created);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Answering
// ---------------------------------------------------------------------------------------------

function ToAnswer({ institutionId }: { institutionId: string }) {
  const [answering, setAnswering] = useState<SurveyToAnswer | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['surveys-to-answer', institutionId],
    queryFn: () => api.get<SurveyToAnswer[]>(`/surveys/to-answer?institutionId=${institutionId}`),
  });
  if (q.error) return <StatePanel kind="error" title={errorText(q.error)} />;
  if (!q.data) return <SkeletonRows label={t.tabs.answer} />;
  return (
    <>
      <Announcer message={note} />
      {q.data.length === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          area="navy"
          title={t.nothingToAnswer}
          body={t.nothingToAnswerBody}
        />
      ) : (
        <Section id="surveys-to-answer" title={t.tabs.answer} flush>
          <ul className="divide-y divide-line">
            {q.data.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{s.title}</span>
                  <span className="text-caption text-ink-muted">
                    {[t.closes(day(s.closesOn)), s.anonymous ? t.anonymousNote : t.namedNote].join(
                      ' · ',
                    )}
                  </span>
                </span>
                <Button size="sm" onClick={() => setAnswering(s)}>
                  {t.answer}
                  <span className="sr-only"> {s.title}</span>
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {answering && (
        <AnswerForm
          institutionId={institutionId}
          survey={answering}
          onClose={() => setAnswering(null)}
          onDone={() => {
            setAnswering(null);
            setNote(t.sent);
          }}
        />
      )}
    </>
  );
}

function AnswerForm({
  institutionId,
  survey,
  onClose,
  onDone,
}: {
  institutionId: string;
  survey: SurveyToAnswer;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const set = (id: string, a: Answer) => setAnswers((x) => ({ ...x, [id]: { ...x[id], ...a } }));
  const save = useMutation({
    mutationFn: () => api.post(`/surveys/${survey.id}/responses`, { institutionId, answers }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['surveys-to-answer'] });
      onDone();
    },
  });
  const ready = survey.questions.every((q) => q.kind !== 'rating' || !!answers[q.id]?.rating);
  return (
    <FormModal
      title={t.answerTitle(survey.title)}
      description={survey.anonymous ? t.anonymousNote : t.namedNote}
      submitLabel={t.submit}
      cancelLabel={t.results.close}
      pending={save.isPending}
      submitDisabled={!ready}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {survey.questions.map((q, i) =>
        q.kind === 'rating' ? (
          <fieldset key={q.id} className="flex flex-col gap-2 sm:col-span-2">
            <legend className="text-body font-medium text-ink">
              {i + 1}. {q.prompt}
            </legend>
            <p className="text-caption text-ink-muted">{t.ratingHint}</p>
            <div className="flex flex-wrap gap-2">
              {[1, 2, 3, 4, 5].map((n) => {
                const on = answers[q.id]?.rating === n;
                return (
                  <label
                    key={n}
                    className={cx(
                      'flex size-11 cursor-pointer items-center justify-center rounded-lg border tabular font-medium has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy-950',
                      on
                        ? 'border-navy-950 bg-navy-950 text-white'
                        : 'border-line bg-surface text-ink',
                    )}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      name={`q-${q.id}`}
                      checked={on}
                      onChange={() => set(q.id, { rating: n })}
                    />
                    <span aria-hidden>{n}</span>
                    <span className="sr-only">{t.ratingLabel(n)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : q.kind === 'choice' ? (
          <ModalField key={q.id} label={`${i + 1}. ${q.prompt}`} hint={t.optional} wide>
            <select
              className={fieldInput}
              value={answers[q.id]?.choice ?? ''}
              onChange={(e) => set(q.id, { choice: e.target.value || null })}
            >
              <option value="">{t.choose}</option>
              {q.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </ModalField>
        ) : (
          <ModalField key={q.id} label={`${i + 1}. ${q.prompt}`} hint={t.optional} wide>
            <textarea
              className={cx(fieldInput, 'h-auto py-2')}
              rows={3}
              maxLength={2000}
              value={answers[q.id]?.text ?? ''}
              onChange={(e) => set(q.id, { text: e.target.value })}
            />
          </ModalField>
        ),
      )}
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Coordinating
// ---------------------------------------------------------------------------------------------

function Manage({ institutionId, onNew }: { institutionId: string; onNew: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['surveys', institutionId],
    queryFn: () => api.get<SurveyRow[]>(`/surveys?institutionId=${institutionId}`),
  });
  if (q.error) return <StatePanel kind="error" title={errorText(q.error)} />;
  if (!q.data) return <SkeletonRows label={t.tabs.manage} />;
  return (
    <>
      {q.data.length === 0 ? (
        <EmptyState
          icon={MessageSquareHeart}
          area="navy"
          title={t.noSurveys}
          body={t.noSurveysBody}
          actions={
            <Button onClick={onNew}>
              <Plus aria-hidden />
              {t.newSurvey}
            </Button>
          }
        />
      ) : (
        <Section id="surveys-manage" title={t.tabs.manage} flush>
          <ul className="divide-y divide-line">
            {q.data.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpen(s.id)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{s.title}</span>
                    <span className="text-caption text-ink-muted">
                      {[
                        t.kinds[s.kind],
                        t.audiences[s.audience],
                        t.results.dates(day(s.opensOn), day(s.closesOn)),
                        t.row(s.responses, s.questions),
                      ].join(' · ')}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {s.openActions > 0 && <Pill>{t.openActions(s.openActions)}</Pill>}
                    <Pill tone={stateTone(s.state)}>{t.states[s.state]}</Pill>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {open && (
        <ResultsDrawer
          institutionId={institutionId}
          surveyId={open}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function CreateForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const f = t.form;
  const qc = useQueryClient();
  const [kind, setKind] = useState<SurveyKind>('course');
  const [title, setTitle] = useState('');
  const [audience, setAudience] = useState<Audience>('students');
  const [anonymous, setAnonymous] = useState(true);
  const [opensOn, setOpensOn] = useState(isoDay());
  const [closesOn, setClosesOn] = useState(isoDay(14));
  const save = useMutation({
    mutationFn: () =>
      api.post('/surveys', { institutionId, kind, title, audience, anonymous, opensOn, closesOn }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['surveys'] });
      onDone();
    },
  });
  return (
    <FormModal
      title={t.newSurvey}
      submitLabel={f.create}
      cancelLabel={t.results.close}
      pending={save.isPending}
      submitDisabled={title.trim().length < 3 || !opensOn || !closesOn || closesOn < opensOn}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.template} hint={f.templateHint}>
        <select
          className={fieldInput}
          value={kind}
          onChange={(e) => {
            const k = e.target.value as SurveyKind;
            setKind(k);
            if (k === 'parent') setAudience('parents');
            if (k === 'faculty' || k === 'course' || k === 'exit') setAudience('students');
          }}
        >
          {SURVEY_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.audience}>
        <select
          className={fieldInput}
          value={audience}
          onChange={(e) => setAudience(e.target.value as Audience)}
        >
          {AUDIENCES.map((a) => (
            <option key={a} value={a}>
              {t.audiences[a]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.title} wide>
        <input
          className={fieldInput}
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.opensOn}>
        <input
          className={fieldInput}
          type="date"
          value={opensOn}
          onChange={(e) => setOpensOn(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.closesOn}>
        <input
          className={fieldInput}
          type="date"
          min={opensOn}
          value={closesOn}
          onChange={(e) => setClosesOn(e.target.value)}
        />
      </ModalField>
      <label className="flex items-start gap-2 sm:col-span-2">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-navy-950"
          checked={anonymous}
          onChange={(e) => setAnonymous(e.target.checked)}
        />
        <span className="flex flex-col">
          <span className="text-body text-ink">{f.anonymous}</span>
          <span className="text-caption text-ink-muted">{f.anonymousHint}</span>
        </span>
      </label>
    </FormModal>
  );
}

type Modal = 'questions' | 'action' | { done: string } | null;

function ResultsDrawer({
  institutionId,
  surveyId,
  onClose,
}: {
  institutionId: string;
  surveyId: string;
  onClose: () => void;
}) {
  const r = t.results;
  const qc = useQueryClient();
  const [modal, setModal] = useState<Modal>(null);
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['survey-results', surveyId],
    queryFn: () =>
      api.get<SurveyResults>(`/surveys/${surveyId}/results?institutionId=${institutionId}`),
  });
  const refresh = async (msg: string) => {
    setModal(null);
    setNote(msg);
    for (const k of ['survey-results', 'surveys', 'surveys-to-answer'])
      await qc.invalidateQueries({ queryKey: [k] });
  };
  const state = useMutation({
    mutationFn: (to: 'open' | 'closed') =>
      api.post(`/surveys/${surveyId}/state`, { institutionId, state: to }),
    onSuccess: (_, to) => refresh(to === 'open' ? r.opened : r.closedNote),
  });
  const d = q.data;
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={d?.title ?? t.title}
      {...(d
        ? {
            subtitle: [t.kinds[d.kind], t.audiences[d.audience], t.states[d.state]].join(' · '),
          }
        : {})}
      closeLabel={r.close}
    >
      <Announcer message={note} />
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !d ? (
        <SkeletonRows label={t.title} />
      ) : (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-2 gap-4 rounded-lg bg-paper px-4 py-3">
            <div>
              <dt className="text-caption text-ink-muted">{r.score}</dt>
              <dd className="font-display text-lead font-semibold text-ink tabular">
                {d.score === null ? r.noScore : r.scoreOf(d.score)}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-ink-muted">{r.responses}</dt>
              <dd className="font-display text-lead font-semibold text-ink tabular">
                {d.responses}
              </dd>
            </div>
          </dl>
          <p className="text-caption text-ink-muted">
            {[r.dates(day(d.opensOn), day(d.closesOn)), d.anonymous ? t.form.anonymous : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {state.error && <StatePanel kind="error" title={errorText(state.error)} />}
          <div className="flex flex-wrap gap-2">
            {d.state === 'draft' && (
              <>
                <Button size="sm" variant="secondary" onClick={() => setModal('questions')}>
                  {t.questions.edit}
                </Button>
                <Button size="sm" onClick={() => state.mutate('open')} disabled={state.isPending}>
                  {r.openSurvey}
                </Button>
              </>
            )}
            {d.state === 'open' && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => state.mutate('closed')}
                disabled={state.isPending}
              >
                {r.closeSurvey}
              </Button>
            )}
          </div>
          <ol className="flex flex-col divide-y divide-line">
            {d.questions.map((qn, i) => (
              <li key={qn.id} className="flex flex-col gap-1 py-3">
                <span className="text-body font-medium text-ink">
                  {i + 1}. {qn.prompt}
                </span>
                <span className="text-caption text-ink-muted">
                  {[
                    t.questions.kinds[qn.kind],
                    qn.kind === 'rating' ? r.weight(qn.weight) : null,
                    r.answered(qn.answered),
                    qn.average !== null ? r.average(qn.average) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {qn.kind !== 'text' && qn.answered > 0 && <Counts counts={qn.counts} />}
                {qn.kind === 'text' &&
                  (qn.comments.length === 0 ? (
                    <span className="text-caption text-ink-muted">{r.noComments}</span>
                  ) : (
                    <ul className="flex flex-col gap-1">
                      {qn.comments.map((c, j) => (
                        <li key={j} className="rounded-md bg-paper px-3 py-2 text-body text-ink">
                          {c}
                        </li>
                      ))}
                    </ul>
                  ))}
              </li>
            ))}
          </ol>
          <section aria-labelledby="survey-actions" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="survey-actions" className="font-display text-lead font-semibold text-ink">
                {r.actions}
              </h3>
              <Button size="sm" variant="secondary" onClick={() => setModal('action')}>
                <Plus aria-hidden />
                {r.addAction}
              </Button>
            </div>
            <p className="text-caption text-ink-muted">{r.actionsHint}</p>
            {d.actions.length === 0 ? (
              <p className="text-body text-ink-muted">{r.noActions}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {d.actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block text-body text-ink">{a.title}</span>
                      <span className="text-caption text-ink-muted">
                        {[
                          a.owner,
                          a.state === 'done' && a.doneOn
                            ? r.doneOn(day(a.doneOn))
                            : r.due(day(a.dueOn)),
                          a.outcome,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    {a.state === 'open' ? (
                      <Button size="sm" variant="quiet" onClick={() => setModal({ done: a.id })}>
                        {r.markDone}
                        <span className="sr-only"> {a.title}</span>
                      </Button>
                    ) : (
                      <Pill tone="go">{r.done}</Pill>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      {modal === 'questions' && d && (
        <QuestionsForm
          institutionId={institutionId}
          survey={d}
          onClose={() => setModal(null)}
          onDone={() => refresh(t.questions.saved)}
        />
      )}
      {modal === 'action' && (
        <ActionForm
          institutionId={institutionId}
          surveyId={surveyId}
          onClose={() => setModal(null)}
          onDone={() => refresh(r.actionAdded)}
        />
      )}
      {modal && typeof modal === 'object' && (
        <DoneForm
          institutionId={institutionId}
          actionId={modal.done}
          onClose={() => setModal(null)}
          onDone={() => refresh(r.actionDone)}
        />
      )}
    </RecordDrawer>
  );
}

function Counts({ counts }: { counts: Record<string, number> }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <dl className="flex flex-col gap-1">
      {Object.entries(counts).map(([k, n]) => (
        <div key={k} className="grid grid-cols-[minmax(0,8rem)_1fr_2.5rem] items-center gap-2">
          <dt className="truncate text-caption text-ink-muted">{k}</dt>
          <dd className="h-2 rounded-full bg-paper" aria-hidden>
            <span
              className="block h-2 rounded-full bg-navy-950"
              style={{ width: `${(n / total) * 100}%` }}
            />
          </dd>
          <dd className="text-right text-caption text-ink tabular">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

type Draft = Question & { key: number; optionsText: string };

function QuestionsForm({
  institutionId,
  survey,
  onClose,
  onDone,
}: {
  institutionId: string;
  survey: SurveyResults;
  onClose: () => void;
  onDone: () => void;
}) {
  const qt = t.questions;
  const [rows, setRows] = useState<Draft[]>(
    survey.questions.map((q, i) => ({
      key: i,
      kind: q.kind,
      prompt: q.prompt,
      weight: q.weight,
      options: [],
      optionsText: q.options.join('\n'),
    })),
  );
  const edit = (key: number, patch: Partial<Draft>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const lines = (s: string) =>
    s
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  const save = useMutation({
    mutationFn: () =>
      api.put(`/surveys/${survey.id}/questions`, {
        institutionId,
        questions: rows.map((r) => ({
          kind: r.kind,
          prompt: r.prompt,
          weight: r.kind === 'rating' ? r.weight : 0,
          options: r.kind === 'choice' ? lines(r.optionsText) : [],
        })),
      }),
    onSuccess: onDone,
  });
  const valid =
    rows.some((r) => r.kind === 'rating') &&
    rows.every(
      (r) =>
        r.prompt.trim().length >= 3 && (r.kind !== 'choice' || lines(r.optionsText).length >= 2),
    );
  return (
    <FormModal
      title={qt.edit}
      {...(rows.some((r) => r.kind === 'rating') ? {} : { description: qt.needRating })}
      submitLabel={qt.save}
      cancelLabel={t.results.close}
      pending={save.isPending}
      submitDisabled={!valid}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ol className="flex flex-col gap-4 sm:col-span-2">
        {rows.map((r, i) => (
          <li key={r.key} className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink-muted">{qt.kind(i + 1)}</span>
                <select
                  className={fieldInput}
                  value={r.kind}
                  onChange={(e) =>
                    edit(r.key, {
                      kind: e.target.value as Question['kind'],
                      weight: e.target.value === 'rating' ? 1 : 0,
                    })
                  }
                >
                  {(['rating', 'choice', 'text'] as const).map((k) => (
                    <option key={k} value={k}>
                      {qt.kinds[k]}
                    </option>
                  ))}
                </select>
              </label>
              {r.kind === 'rating' && (
                <label className="flex w-24 flex-col gap-1">
                  <span className="text-caption text-ink-muted">{qt.weight(i + 1)}</span>
                  <input
                    className={fieldInput}
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    value={r.weight}
                    onChange={(e) => edit(r.key, { weight: Number(e.target.value) })}
                  />
                </label>
              )}
              <Button
                size="sm"
                variant="quiet"
                className="ml-auto"
                onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
              >
                <Trash2 aria-hidden />
                <span className="sr-only">{qt.remove(i + 1)}</span>
              </Button>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-muted">{qt.prompt(i + 1)}</span>
              <input
                className={fieldInput}
                value={r.prompt}
                maxLength={300}
                onChange={(e) => edit(r.key, { prompt: e.target.value })}
              />
            </label>
            {r.kind === 'choice' && (
              <label className="flex flex-col gap-1">
                <span className="text-caption text-ink-muted">
                  {qt.options(i + 1)} · {qt.optionsHint}
                </span>
                <textarea
                  className={cx(fieldInput, 'h-auto py-2')}
                  rows={3}
                  value={r.optionsText}
                  onChange={(e) => edit(r.key, { optionsText: e.target.value })}
                />
              </label>
            )}
          </li>
        ))}
      </ol>
      <div className="sm:col-span-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={rows.length >= 40}
          onClick={() =>
            setRows((rs) => [
              ...rs,
              {
                key: Math.max(-1, ...rs.map((x) => x.key)) + 1,
                kind: 'rating',
                prompt: '',
                weight: 1,
                options: [],
                optionsText: '',
              },
            ])
          }
        >
          <Plus aria-hidden />
          {qt.add}
        </Button>
      </div>
    </FormModal>
  );
}

function ActionForm({
  institutionId,
  surveyId,
  onClose,
  onDone,
}: {
  institutionId: string;
  surveyId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const r = t.results;
  const staff = useQuery({
    queryKey: ['survey-staff', institutionId],
    queryFn: () =>
      api.get<{ personId: string; name: string }[]>(`/people/staff?institutionId=${institutionId}`),
  });
  const [title, setTitle] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [dueOn, setDueOn] = useState(isoDay(30));
  const save = useMutation({
    mutationFn: () =>
      api.post(`/surveys/${surveyId}/actions`, { institutionId, title, ownerId, dueOn }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={r.addAction}
      submitLabel={r.addAction}
      cancelLabel={r.close}
      pending={save.isPending}
      submitDisabled={title.trim().length < 3 || !ownerId || !dueOn}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={r.actionTitle} wide>
        <input
          className={fieldInput}
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
        />
      </ModalField>
      <ModalField label={r.owner}>
        <select className={fieldInput} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
          <option value="">{t.choose}</option>
          {(staff.data ?? []).map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={r.dueOn}>
        <input
          className={fieldInput}
          type="date"
          value={dueOn}
          onChange={(e) => setDueOn(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function DoneForm({
  institutionId,
  actionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  actionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const r = t.results;
  const [outcome, setOutcome] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/surveys/actions/${actionId}/done`, { institutionId, outcome }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={r.markDone}
      submitLabel={r.markDone}
      cancelLabel={r.close}
      pending={save.isPending}
      submitDisabled={outcome.trim().length < 3}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={r.outcome} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={4}
          maxLength={2000}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}
