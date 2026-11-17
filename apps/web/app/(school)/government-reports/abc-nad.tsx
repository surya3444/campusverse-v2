'use client';

// Government Reports › ABC & NAD (rule book §15: "credit and marksheet upload against APAAR";
// P0 item 15): a published term's credits with full ABC and APAAR IDs, as an audited download.
import type { AbcCreditFile, ExamBoard } from '@campusverse/academics-exams';
import type { StructureOverview } from '@campusverse/academics-structure';
import { Button, EmptyState, Section, SkeletonRows } from '@campusverse/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, Landmark } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';

const t = en.abcNad;
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function AbcNad({ institutionId }: { institutionId: string }) {
  const overview = useQuery({
    queryKey: ['academics', institutionId],
    queryFn: () =>
      api.get<StructureOverview>(`/academics/structure?institutionId=${institutionId}`),
  });
  const batches = overview.data?.batches ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const batchId = batches.find((b) => b.id === chosen)?.id ?? batches[0]?.id;
  const board = useQuery({
    queryKey: ['exam-board', batchId],
    queryFn: () => api.get<ExamBoard>(`/academics/batches/${batchId}/exams`),
    enabled: !!batchId,
  });
  const terms = board.data?.publishedTerms ?? [];
  const [term, setTerm] = useState<number | null>(null);
  const pick = term && terms.includes(term) ? term : terms.at(-1);
  const kind = board.data ? (en.academics.termKinds[board.data.batch.termKind] ?? '') : '';
  const download = useMutation({
    mutationFn: () => api.get<AbcCreditFile>(`/academics/batches/${batchId}/abc?term=${pick}`),
    onSuccess: (f) => {
      const url = URL.createObjectURL(new Blob([f.csv], { type: 'text/csv' }));
      const name = batches.find((b) => b.id === batchId);
      const a = Object.assign(document.createElement('a'), {
        href: url,
        download: `ABC-${name?.programCode ?? 'batch'}-${name?.label ?? ''}-term${f.term}.csv`,
      });
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const f = download.data;
  return (
    <Section id="abc-nad" title={t.title} description={t.lead}>
      {!overview.data || (batchId && !board.data) ? (
        <SkeletonRows rows={2} label={en.states.loading.title} />
      ) : batches.length === 0 || terms.length === 0 ? (
        <>
          {batches.length > 1 && (
            <label className="mb-3 flex max-w-sm flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.batch}</span>
              <select
                value={batchId}
                onChange={(e) => setChosen(e.target.value)}
                className={fieldInput}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.programCode} {b.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <EmptyState icon={Landmark} area="navy" title={t.none} compact />
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-56 flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.batch}</span>
              <select
                value={batchId}
                onChange={(e) => (setChosen(e.target.value), download.reset())}
                className={fieldInput}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.programCode} {b.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-40 flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.term}</span>
              <select
                value={pick}
                onChange={(e) => (setTerm(Number(e.target.value)), download.reset())}
                className={fieldInput}
              >
                {terms.map((n) => (
                  <option key={n} value={n}>
                    {kind} {n}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="secondary"
              disabled={download.isPending}
              onClick={() => download.mutate()}
            >
              <Download aria-hidden className="size-4" />
              {t.download}
            </Button>
          </div>
          {download.error && (
            <p role="alert" className="text-caption text-signal-stop-ink">
              {errorText(download.error)}
            </p>
          )}
          {f && (
            <p role="status" className="text-caption text-ink-muted">
              {t.rows(f.students, f.rows)}
            </p>
          )}
          {f && f.withoutAbc.length > 0 && (
            <p className="text-caption text-signal-warn-ink">
              {t.withoutAbc(f.withoutAbc.map((s) => s.name).join(', '))}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
