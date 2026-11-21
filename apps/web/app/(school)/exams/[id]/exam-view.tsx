'use client';

import type { ExamDetail } from '@campusverse/school-exams';
import {
  Announcer,
  Button,
  FormModal,
  PageHeader,
  PreviewCanvas,
  Segmented,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BookCheck, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useMe } from '../../common/me';
import { useUrlTab } from '../../common/url-tab';
import { PartsEditor, partsReady, type Part } from '../parts-editor';
import { EXAM_CHIP, examError, t } from '../shared';
import { AnalysisPanel, DateSheetPanel } from './exam-tabs';
import { ReportCardPanel } from './report-card-tab';

const TABS = ['papers', 'reportCard', 'dateSheet', 'analysis'] as const;
type Tab = (typeof TABS)[number];
type Paper = ExamDetail['classes'][number]['papers'][number];
/** "Science" from "Science · Theory". */
const subjectOf = (p: Paper) =>
  p.part && p.subject.endsWith(` · ${p.part}`)
    ? p.subject.slice(0, -` · ${p.part}`.length)
    : p.subject;

export function ExamView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { can } = useMe();
  const [tab, setTab] = useUrlTab<Tab>(TABS, 'papers');
  const [splitting, setSplitting] = useState<{
    classId: string;
    cls: string;
    subjectId: string;
    subject: string;
    papers: Paper[];
  } | null>(null);
  const exam = useQuery({
    queryKey: ['exam', id],
    queryFn: () => api.get<ExamDetail>(`/school/exams/${id}`),
  });
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['exam', id] });
  const lock = useMutation({
    mutationFn: () => api.post(`/school/exams/${id}/lock`, {}),
    onSuccess: refresh,
  });
  const publish = useMutation({
    mutationFn: () => api.post<{ results: number }>(`/school/exams/${id}/publish`, {}),
    onSuccess: (r) => {
      setPublishing(false);
      setNotice(t.published(r.results));
      void refresh();
    },
  });
  const decide = useMutation({
    mutationFn: (v: { changeId: string; approve: boolean }) =>
      api.post(`/school/exams/changes/${v.changeId}/decide`, { approve: v.approve }),
    onSuccess: refresh,
  });

  if (exam.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (exam.isError)
    return exam.error instanceof ApiFailure && exam.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={examError(exam.error)} />
    );
  const e = exam.data;
  const papers = e.classes.flatMap((c) => c.papers);
  const students = e.classes.reduce(
    (n, c) => n + c.sections.reduce((m, s) => m + s.students, 0),
    0,
  );
  const error = lock.error ?? decide.error ?? publish.error;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/exams"
        className="flex w-fit items-center gap-1.5 text-caption text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.back}
      </Link>
      <PageHeader
        icon={BookCheck}
        area="violet"
        eyebrow={en.nav.groups.academics}
        title={e.name}
        description={t.pageLead}
        actions={
          e.state === 'marks_open' && can('school.exam.manage') ? (
            <Button
              onClick={() => lock.mutate()}
              disabled={lock.isPending || papers.some((p) => !p.submitted)}
              title={t.lockHint}
            >
              {t.lock}
            </Button>
          ) : e.state === 'marks_locked' && can('school.exam.publish') ? (
            <Button onClick={() => setPublishing(true)}>{t.publish}</Button>
          ) : undefined
        }
      >
        <>
          <span
            className={cx(
              'rounded-full px-2.5 py-0.5 text-caption font-medium',
              EXAM_CHIP[e.state],
            )}
          >
            {t.states[e.state]}
          </span>
          <Segmented
            label={e.name}
            value={tab}
            onChange={setTab}
            options={TABS.map((k) => ({ value: k, label: en.examTabs[k] }))}
          />
        </>
      </PageHeader>
      {e.state === 'marks_open' && <p className="text-caption text-ink-muted">{t.lockHint}</p>}
      {error && (
        <p role="alert" className="text-caption text-signal-stop-ink">
          {examError(error)}
        </p>
      )}
      {notice && <Announcer message={notice} />}

      {e.changes.length > 0 && (
        <section aria-labelledby="changes" className="panel">
          <h2
            id="changes"
            className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink"
          >
            {t.changes}
          </h2>
          <ul className="divide-y divide-line">
            {e.changes.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink tabular-nums">
                    {t.changeLine(c.student, c.subject, c.newMark, c.requestedBy)}
                  </span>
                  <span className="text-caption text-ink-muted">{c.reason}</span>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ changeId: c.id, approve: false })}
                >
                  {t.reject}
                </Button>
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ changeId: c.id, approve: true })}
                >
                  {t.approve}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'papers' && (
        <div className="flex flex-col gap-6">
          {e.classes.map((c) => (
            <section key={c.classId} aria-labelledby={`c-${c.classId}`} className="panel">
              <h2
                id={`c-${c.classId}`}
                className="border-b border-line px-5 py-3.5 text-body font-semibold text-ink"
              >
                {c.name}
              </h2>
              <div tabIndex={0} role="region" aria-label={c.name} className="overflow-x-auto">
                <table className="w-full text-body">
                  <thead>
                    <tr className="text-left text-caption text-ink-muted">
                      <th className="px-5 py-2 font-medium">{t.subject}</th>
                      <th className="px-3 py-2 font-medium">{t.part}</th>
                      <th className="px-3 py-2 font-medium">{t.outOf}</th>
                      <th className="px-3 py-2 font-medium">{t.entered}</th>
                      <th className="px-3 py-2 font-medium">{t.enterMarks}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {c.papers.map((p, i) => {
                      const group = c.papers.filter((x) => x.subjectId === p.subjectId);
                      const first = c.papers.findIndex((x) => x.subjectId === p.subjectId) === i;
                      const editable =
                        e.state === 'marks_open' &&
                        can('school.exam.manage') &&
                        group.every((x) => x.entered === 0);
                      return (
                        <tr key={p.paperId}>
                          {first && (
                            <th
                              scope="rowgroup"
                              rowSpan={group.length}
                              className="px-5 py-2.5 text-left align-top font-medium text-ink"
                            >
                              <span className="flex flex-col items-start gap-1">
                                {subjectOf(p)}
                                {editable && (
                                  <button
                                    type="button"
                                    aria-haspopup="dialog"
                                    aria-label={`${t.changeSplit}: ${subjectOf(p)}, ${c.name}`}
                                    onClick={() =>
                                      setSplitting({
                                        classId: c.classId,
                                        cls: c.name,
                                        subjectId: p.subjectId,
                                        subject: subjectOf(p),
                                        papers: group,
                                      })
                                    }
                                    className="text-caption font-normal text-navy-950 underline-offset-2 hover:underline"
                                  >
                                    {t.changeSplit}
                                  </button>
                                )}
                              </span>
                            </th>
                          )}
                          <td className="px-3 py-2.5 text-ink">
                            <span className="flex items-center gap-2">
                              {p.part || t.splitWhole}
                              {p.submitted && (
                                <CheckCircle2
                                  aria-label={t.submitted}
                                  className="size-4 text-signal-go-ink"
                                />
                              )}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums">{p.maxMarks}</td>
                          <td
                            className={cx(
                              'px-3 py-2.5 tabular-nums',
                              p.blanks > 0 ? 'text-signal-warn-ink' : 'text-ink-muted',
                            )}
                          >
                            {t.blanks(p.blanks)}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="flex flex-wrap gap-2">
                              {c.sections.map((s) => (
                                <Link
                                  key={s.sectionId}
                                  href={`/exams/${id}/marks?paper=${p.paperId}&section=${s.sectionId}`}
                                  aria-label={`${t.enterMarks}: ${p.subject}, ${s.label}`}
                                  className="rounded-md border border-line px-2.5 py-1 text-caption text-navy-950 hover:bg-navy-50"
                                >
                                  {s.label}
                                </Link>
                              ))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
      {tab === 'reportCard' && <ReportCardPanel examId={id} classes={e.classes} />}
      {tab === 'dateSheet' && <DateSheetPanel examId={id} />}
      {tab === 'analysis' && <AnalysisPanel examId={id} />}
      {splitting && (
        <SplitForm
          examId={id}
          target={splitting}
          onClose={() => setSplitting(null)}
          onSaved={() => {
            setSplitting(null);
            setNotice(t.splitSaved);
            void refresh();
          }}
        />
      )}

      <PreviewCanvas
        open={publishing}
        onOpenChange={setPublishing}
        title={t.publishTitle}
        actionLabel={t.publish}
        changes={t.publishChanges(e.gradeScheme ?? '')}
        affected={[{ label: t.students, count: students }]}
        risks={[]}
        undo={t.publishUndo}
        busy={publish.isPending}
        labels={en.preview}
        onConfirm={() => publish.mutate()}
      />
    </div>
  );
}

function SplitForm({
  examId,
  target,
  onClose,
  onSaved,
}: {
  examId: string;
  target: { classId: string; cls: string; subjectId: string; subject: string; papers: Paper[] };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [parts, setParts] = useState<Part[]>(
    target.papers.map((p) => ({ name: p.part, maxMarks: p.maxMarks })),
  );
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/exams/${examId}/subject-parts`, {
        classId: target.classId,
        subjectId: target.subjectId,
        parts: parts.length === 1 ? [{ name: '', maxMarks: parts[0]?.maxMarks ?? '' }] : parts,
      }),
    onSuccess: onSaved,
  });
  return (
    <FormModal
      title={t.changeSplitFor(target.subject, target.cls)}
      description={t.changeSplitLead}
      size="lg"
      submitLabel={en.form.save}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!partsReady(parts)}
      error={save.isError ? examError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <PartsEditor value={parts} onChange={setParts} />
    </FormModal>
  );
}
