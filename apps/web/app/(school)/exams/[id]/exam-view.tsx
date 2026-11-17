'use client';

import type { ExamDetail } from '@campusverse/school-exams';
import { Announcer, Button, PreviewCanvas, StatePanel, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { EXAM_CHIP, examError, t } from '../shared';
import { AnalysisPanel, DateSheetPanel } from './exam-tabs';
import { Tabs } from 'radix-ui';

export function ExamView({ id }: { id: string }) {
  const qc = useQueryClient();
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title font-semibold text-ink">{e.name}</h1>
          <span
            className={cx(
              'rounded-full px-2.5 py-0.5 text-caption font-medium',
              EXAM_CHIP[e.state],
            )}
          >
            {t.states[e.state]}
          </span>
        </div>
        <div className="flex gap-2">
          {e.state === 'marks_open' && (
            <Button
              onClick={() => lock.mutate()}
              disabled={lock.isPending || papers.some((p) => !p.submitted)}
              title={t.lockHint}
            >
              {t.lock}
            </Button>
          )}
          {e.state === 'marks_locked' && (
            <Button onClick={() => setPublishing(true)}>{t.publish}</Button>
          )}
        </div>
      </div>
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

      <Tabs.Root defaultValue="papers" className="flex flex-col gap-5">
        <Tabs.List aria-label={e.name} className="flex gap-1 overflow-x-auto border-b border-line">
          {(['papers', 'dateSheet', 'analysis'] as const).map((k) => (
            <Tabs.Trigger
              key={k}
              value={k}
              className="-mb-px inline-flex h-11 shrink-0 items-center border-b-2 border-transparent px-4 text-body text-ink-muted hover:text-ink data-[state=active]:border-navy-950 data-[state=active]:font-semibold data-[state=active]:text-navy-950"
            >
              {en.examTabs[k]}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="papers" className="flex flex-col gap-6">
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
                      <th className="px-3 py-2 font-medium">{t.outOf}</th>
                      <th className="px-3 py-2 font-medium">{t.entered}</th>
                      <th className="px-3 py-2 font-medium">{t.enterMarks}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {c.papers.map((p) => (
                      <tr key={p.paperId}>
                        <td className="px-5 py-2.5 text-ink">
                          <span className="flex items-center gap-2">
                            {p.subject}
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
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </Tabs.Content>
        <Tabs.Content value="dateSheet">
          <DateSheetPanel examId={id} />
        </Tabs.Content>
        <Tabs.Content value="analysis">
          <AnalysisPanel examId={id} />
        </Tabs.Content>
      </Tabs.Root>

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
