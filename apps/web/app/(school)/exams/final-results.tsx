'use client';

// The year's final results on the exams screen: exams combined with weights (Half-yearly 40% +
// Annual 60%) into each subject's year result and the final report card.
import type { ExamSummary, ResultPlanSummary } from '@campusverse/school-exams';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Section,
  SkeletonRows,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sigma } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useMe } from '../common/me';
import { examError, field, t, useYears } from './shared';

export const FINAL_CHIP: Record<string, string> = {
  draft: 'bg-signal-warn-tint text-signal-warn-ink',
  published: 'bg-signal-go-tint text-signal-go-ink',
};
export const weightsText = (p: ResultPlanSummary) =>
  t.weights(p.exams.map((x) => `${x.name} ${x.weightBp / 100}%`).join(' + '));

export function FinalResults({
  institutionId,
  exams,
}: {
  institutionId: string;
  exams: ExamSummary[];
}) {
  const { can } = useMe();
  const [open, setOpen] = useState(false);
  const list = useQuery({
    queryKey: ['final-results', institutionId],
    queryFn: () =>
      api.get<ResultPlanSummary[]>(`/school/exams/institution/${institutionId}/final-results`),
  });
  const manage = can('school.exam.manage');
  return (
    <Section
      title={t.finals}
      description={t.finalsLead}
      flush
      actions={
        manage ? (
          <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
            <Plus aria-hidden className="size-4" />
            {t.newFinal}
          </Button>
        ) : undefined
      }
    >
      {list.isPending ? (
        <SkeletonRows rows={2} label={t.finals} />
      ) : list.isError ? (
        <p role="alert" className="px-5 py-4 text-caption text-signal-stop-ink">
          {examError(list.error)}
        </p>
      ) : list.data.length === 0 ? (
        <EmptyState icon={Sigma} area="violet" title={t.finalsEmpty} body={t.finalsEmptyBody} />
      ) : (
        <ul className="divide-y divide-line">
          {list.data.map((p) => (
            <li key={p.id}>
              <Link
                href={`/exams/final/${p.id}`}
                className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-paper"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-navy-950">{p.name}</span>
                  <span className="text-caption text-ink-muted tabular-nums">
                    {p.yearLabel} · {weightsText(p)}
                  </span>
                </span>
                <span
                  className={cx(
                    'rounded-full px-2.5 py-0.5 text-caption font-medium whitespace-nowrap',
                    FINAL_CHIP[p.state],
                  )}
                >
                  {t.finalStates[p.state]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <FinalForm institutionId={institutionId} exams={exams} onClose={() => setOpen(false)} />
      )}
    </Section>
  );
}

/** New final result, or its weights changed while it is a draft. */
export function FinalForm({
  institutionId,
  exams,
  plan,
  onClose,
}: {
  institutionId: string;
  exams: ExamSummary[];
  plan?: ResultPlanSummary;
  onClose: () => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const ref = useYears(institutionId);
  const current = ref.data?.years.find((y) => y.status === 'active') ?? ref.data?.years.at(-1);
  const [yearId, setYearId] = useState(plan?.yearId ?? '');
  const year = yearId || current?.yearId || '';
  const [name, setName] = useState(plan?.name ?? '');
  const [classIds, setClassIds] = useState<string[]>(plan?.classIds ?? []);
  const [weights, setWeights] = useState<Record<string, string>>(
    Object.fromEntries((plan?.exams ?? []).map((x) => [x.examId, String(x.weightBp / 100)])),
  );
  // Oldest first, as the year went: Half-yearly, then Annual.
  const fits = [...exams]
    .reverse()
    .filter(
      (x) =>
        x.yearId === year &&
        x.state !== 'cancelled' &&
        classIds.length > 0 &&
        classIds.every((c) => x.classIds.includes(c)),
    );
  const chosen = fits
    .map((x) => ({ examId: x.id, weight: Number(weights[x.id] ?? '') }))
    .filter((x) => Number.isFinite(x.weight) && x.weight > 0);
  const total = chosen.reduce((a, x) => a + x.weight, 0);
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/school/exams/institution/${institutionId}/final-results`, {
        id: plan?.id ?? null,
        yearId: year,
        name,
        classIds,
        exams: chosen.map((x) => ({ examId: x.examId, weightBp: Math.round(x.weight * 100) })),
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['final-results', institutionId] });
      void qc.invalidateQueries({ queryKey: ['final-result', r.id] });
      if (plan) onClose();
      else router.push(`/exams/final/${r.id}`);
    },
  });
  return (
    <FormModal
      title={plan ? t.editFinal : t.newFinal}
      size="lg"
      submitLabel={plan ? en.form.save : t.newFinal}
      cancelLabel={en.form.cancel}
      pending={save.isPending || ref.isPending}
      submitDisabled={!name.trim() || chosen.length === 0 || Math.abs(total - 100) > 0.001}
      error={save.isError ? examError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.year}</span>
        <select
          value={year}
          disabled={!!plan}
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
      <ModalField label={t.finalName} hint={t.finalNameHint}>
        <input
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={field}
        />
      </ModalField>
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
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1 text-caption font-medium text-ink">{t.finalExams}</legend>
        <p className="text-caption text-ink-muted">{t.finalExamsHint}</p>
        {classIds.length > 0 && fits.length === 0 ? (
          <p className="text-caption text-signal-warn-ink">{t.noExamsForFinal}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {fits.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">{x.name}</span>
                  <span className="text-caption text-ink-muted">{t.states[x.state]}</span>
                </span>
                <label className="flex items-center gap-2 text-caption text-ink-muted">
                  <span className="sr-only">{t.weightFor(x.name)}</span>
                  <input
                    inputMode="decimal"
                    pattern="\d{1,3}(\.\d{1,2})?"
                    value={weights[x.id] ?? ''}
                    placeholder="0"
                    onChange={(e) => setWeights((w) => ({ ...w, [x.id]: e.target.value }))}
                    className={cx(field, 'w-20 text-right tabular-nums')}
                  />
                  <span aria-hidden>%</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {fits.length > 0 && (
          <p
            aria-live="polite"
            className={cx(
              'text-right text-caption font-medium tabular-nums',
              Math.abs(total - 100) > 0.001 ? 'text-signal-warn-ink' : 'text-signal-go-ink',
            )}
          >
            {t.weightsTotal(Math.round(total * 100) / 100)}
          </p>
        )}
      </fieldset>
    </FormModal>
  );
}
