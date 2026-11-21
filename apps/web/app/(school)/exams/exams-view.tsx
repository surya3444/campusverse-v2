'use client';

import type { ExamSummary } from '@campusverse/school-exams';
import { Button, EmptyState, FormModal, PageHeader, StatePanel, cx } from '@campusverse/ui';
import { BookCheck, Plus } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { FinalResults } from './final-results';
import { PartsEditor, partsReady, type Part } from './parts-editor';
import { EXAM_CHIP, examError, field, t, useYears } from './shared';

export function ExamsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const list = useQuery({
    queryKey: ['exams', id],
    queryFn: () => api.get<ExamSummary[]>(`/school/exams/institution/${id}`),
    enabled: !!id,
  });
  const [open, setOpen] = useState(useSearchParams().has('new'));
  if (school.isPending || (list.isPending && !!id))
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (list.isError || school.isError) {
    return list.error instanceof ApiFailure && list.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={examError(list.error ?? school.error)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BookCheck}
        art="exams"
        eyebrow={en.nav.groups.academics}
        area="violet"
        title={t.title}
        description={t.lead}
        actions={
          <Button onClick={() => setOpen(true)} aria-haspopup="dialog">
            <Plus aria-hidden className="size-4" />
            {t.newExam}
          </Button>
        }
      />
      {open && id && <CreateForm institutionId={id} onClose={() => setOpen(false)} />}
      {!list.data || list.data.length === 0 ? (
        <div className="panel">
          <EmptyState
            art="exams"
            icon={BookCheck}
            area="violet"
            title={t.empty}
            body={t.emptyBody}
          />
        </div>
      ) : (
        <ul className="panel divide-y divide-line">
          {list.data.map((x) => (
            <li key={x.id}>
              <Link
                href={`/exams/${x.id}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-navy-950">{x.name}</span>
                  <span className="text-caption text-ink-muted tabular-nums">
                    {x.yearLabel} · {t.progress(x.submitted, x.papers)}
                  </span>
                </span>
                <span
                  className={cx(
                    'rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
                    EXAM_CHIP[x.state],
                  )}
                >
                  {t.states[x.state]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {id && <FinalResults institutionId={id} exams={list.data ?? []} />}
    </div>
  );
}

function CreateForm({ institutionId, onClose }: { institutionId: string; onClose: () => void }) {
  const router = useRouter();
  const ref = useYears(institutionId);
  const current = ref.data?.years.find((y) => y.status === 'active') ?? ref.data?.years.at(-1);
  const [yearId, setYearId] = useState('');
  const [name, setName] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]);
  const [parts, setParts] = useState<Part[]>([{ name: '', maxMarks: '100' }]);
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/school/exams/institution/${institutionId}`, {
        yearId: yearId || current?.yearId,
        name,
        classIds,
        maxMarks: parts.length === 1 ? (parts[0]?.maxMarks ?? '100') : '100',
        parts: parts.length > 1 ? parts : null,
      }),
    onSuccess: (r) => router.push(`/exams/${r.id}`),
  });
  return (
    <FormModal
      title={t.newExam}
      size="lg"
      submitLabel={t.create}
      cancelLabel={en.form.cancel}
      pending={save.isPending || ref.isPending}
      submitDisabled={!name || classIds.length === 0 || !partsReady(parts)}
      error={save.isError ? examError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.year}</span>
        <select
          value={yearId || current?.yearId || ''}
          onChange={(e) => setYearId(e.target.value)}
          className={field}
        >
          {ref.data?.years.map((y) => (
            <option key={y.yearId} value={y.yearId}>
              {y.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.name}</span>
        <input
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </label>
      <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
        <legend className="mb-1.5 text-caption font-medium text-ink">{t.classes}</legend>
        <div className="flex flex-wrap gap-2">
          {ref.data?.classes.map((c) => (
            <label
              key={c.classId}
              className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-body text-ink has-[:checked]:border-navy-950 has-[:checked]:bg-navy-50"
            >
              <input
                type="checkbox"
                checked={classIds.includes(c.classId)}
                onChange={(e) =>
                  setClassIds((ids) =>
                    e.target.checked ? [...ids, c.classId] : ids.filter((x) => x !== c.classId),
                  )
                }
              />
              {c.name}
            </label>
          ))}
        </div>
      </fieldset>
      <PartsEditor value={parts} onChange={setParts} />
    </FormModal>
  );
}
