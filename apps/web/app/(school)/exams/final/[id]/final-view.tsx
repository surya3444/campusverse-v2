'use client';

// One final result: the exams and weights, each student's year result before it is published,
// and Publish, which issues the year's report cards.
import type { ExamSummary, ResultPlanDetail } from '@campusverse/school-exams';
import {
  Announcer,
  Button,
  PageHeader,
  PreviewCanvas,
  Section,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Sigma } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../../lib/api';
import { en } from '../../../../../messages/en';
import { useMe } from '../../../common/me';
import { FINAL_CHIP, FinalForm, weightsText } from '../../final-results';
import { examError, t } from '../../shared';

const pct = (bp: number | null) =>
  bp === null ? '—' : `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}`;

export function FinalView({ id }: { id: string }) {
  const qc = useQueryClient();
  const { can } = useMe();
  const plan = useQuery({
    queryKey: ['final-result', id],
    queryFn: () => api.get<ResultPlanDetail>(`/school/exams/final-results/${id}`),
  });
  const [editing, setEditing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState('');
  const publish = useMutation({
    mutationFn: () =>
      api.post<{ results: number }>(`/school/exams/final-results/${id}/publish`, {}),
    onSuccess: (r) => {
      setPublishing(false);
      setNotice(t.finalPublished(r.results));
      void qc.invalidateQueries({ queryKey: ['final-result', id] });
    },
  });
  const institutionId = plan.data?.institutionId;
  const exams = useQuery({
    queryKey: ['exams', institutionId],
    queryFn: () => api.get<ExamSummary[]>(`/school/exams/institution/${institutionId}`),
    enabled: editing && !!institutionId,
  });

  if (plan.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (plan.isError)
    return plan.error instanceof ApiFailure && plan.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={examError(plan.error)} />
    );
  const p = plan.data;
  const draft = p.state === 'draft';
  const subjects = p.students?.[0]?.subjects.map((s) => s.subject) ?? [];
  const pass = p.passBasisPoints === null ? '' : `${pct(p.passBasisPoints)}%`;

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/exams"
        className="flex w-fit items-center gap-1.5 text-caption text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t.backToExams}
      </Link>
      <PageHeader
        icon={Sigma}
        area="violet"
        eyebrow={en.nav.groups.academics}
        title={p.name}
        description={`${p.yearLabel} · ${p.classes.map((c) => c.name).join(', ')} · ${weightsText(p)}`}
        actions={
          draft && can('school.exam.manage') ? (
            <>
              <Button variant="secondary" onClick={() => setEditing(true)} aria-haspopup="dialog">
                {t.editFinal}
              </Button>
              {can('school.exam.publish') && (
                <Button
                  onClick={() => setPublishing(true)}
                  disabled={!p.students || p.students.length === 0}
                >
                  {t.publishFinal}
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        <span
          className={cx(
            'w-fit rounded-full px-2.5 py-0.5 text-caption font-medium',
            FINAL_CHIP[p.state],
          )}
        >
          {t.finalStates[p.state]}
        </span>
      </PageHeader>
      <Announcer message={notice} />
      {publish.isError && (
        <p role="alert" className="text-caption text-signal-stop-ink">
          {examError(publish.error)}
        </p>
      )}
      {p.waitingFor.length > 0 && (
        <p className="rounded-md bg-signal-warn-tint px-4 py-3 text-body text-signal-warn-ink">
          {t.waitingFor(p.waitingFor.join(', '))}
        </p>
      )}

      {p.students && (
        <Section
          title={t.previewTitle}
          description={`${t.previewLead(pass)} ${t.byExamOrder(p.exams.map((x) => x.name).join(' · '))}`}
          flush
        >
          {p.students.length === 0 ? (
            <p className="px-5 py-4 text-body text-ink-muted">{t.noStudents}</p>
          ) : (
            <div role="region" aria-label={t.previewTitle} tabIndex={0} className="overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="border-b border-line text-left text-caption text-ink-muted">
                    <th scope="col" className="sticky left-0 bg-surface px-5 py-2.5 font-medium">
                      {t.student}
                    </th>
                    {subjects.map((s) => (
                      <th key={s} scope="col" className="px-3 py-2.5 font-medium whitespace-nowrap">
                        {s}
                      </th>
                    ))}
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      {t.overall}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {p.students.map((r) => (
                    <tr key={r.studentId}>
                      <th
                        scope="row"
                        className="sticky left-0 bg-surface px-5 py-2.5 text-left font-normal"
                      >
                        <span className="flex flex-col">
                          <span className="text-ink">{r.name}</span>
                          <span className="text-caption text-ink-muted">
                            {r.section}
                            {r.below.length > 0 ? (
                              <span className="text-signal-stop-ink">
                                {' · '}
                                {t.belowPass(r.below.join(', '))}
                              </span>
                            ) : (
                              ` · ${t.passed}`
                            )}
                          </span>
                        </span>
                      </th>
                      {r.subjects.map((s) => {
                        const below =
                          p.passBasisPoints !== null &&
                          s.percentBp !== null &&
                          s.percentBp < p.passBasisPoints;
                        return (
                          <td key={s.subjectId} className="px-3 py-2.5 align-top tabular-nums">
                            <span
                              className={cx(
                                'block font-medium whitespace-nowrap',
                                below ? 'text-signal-stop-ink' : 'text-ink',
                              )}
                            >
                              {pct(s.percentBp)}% {s.grade ?? ''}
                            </span>
                            <span className="block text-caption whitespace-nowrap text-ink-muted">
                              {s.byExam.map((b) => pct(b)).join(' · ')}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2.5 align-top font-semibold whitespace-nowrap tabular-nums text-ink">
                        {pct(r.percentBp)}% {r.grade ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {editing && institutionId && (
        <FinalForm
          institutionId={institutionId}
          exams={exams.data ?? []}
          plan={p}
          onClose={() => setEditing(false)}
        />
      )}
      <PreviewCanvas
        open={publishing}
        onOpenChange={setPublishing}
        title={t.publishFinal}
        actionLabel={t.publishFinal}
        changes={t.publishFinalChanges(p.gradeScheme ?? '')}
        affected={[{ label: t.students, count: p.students?.length ?? 0 }]}
        risks={[]}
        undo={t.publishFinalUndo}
        busy={publish.isPending}
        labels={en.preview}
        onConfirm={() => publish.mutate()}
      />
    </div>
  );
}
