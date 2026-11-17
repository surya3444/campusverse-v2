'use client';

// Exams & Results › Re-exams (rule book §13.2: "revaluation, supplementary"; P0 item 12): courses
// still failed (register a supplementary exam), every re-exam with its new end-exam mark, and the
// new grade approved through the workflow engine before it counts.
import type { ReexamBoard, ReexamItem } from '@campusverse/academics-exams';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';

const t = en.examResults.reexams;
const STATE_TONE: Record<string, Tone> = {
  requested: 'neutral',
  marked: 'warn',
  approved: 'go',
  rejected: 'stop',
};
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? en.examResults.errors.forbidden
      : (en.examResults.errors[e.code] ?? en.examResults.errors.error)
    : en.examResults.errors.error) ?? '';

export const reexamKey = (batchId: string) => ['reexams', batchId];

/** Registers a re-exam (from this list or a grade card). */
export function useRequestReexam(batchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      term: number;
      studentId: string;
      courseId: string;
      kind: ReexamItem['kind'];
    }) => api.post(`/academics/batches/${batchId}/reexams`, v),
    onSettled: () => qc.invalidateQueries({ queryKey: reexamKey(batchId) }),
  });
}

export function Reexams({
  batchId,
  termKind,
  canManage,
  canMark,
}: {
  batchId: string;
  termKind: string;
  canManage: boolean;
  canMark: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: reexamKey(batchId),
    queryFn: () => api.get<ReexamBoard>(`/academics/batches/${batchId}/reexams`),
  });
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: reexamKey(batchId) });
    await qc.invalidateQueries({ queryKey: ['grade-card', batchId] });
  };
  const ask = useRequestReexam(batchId);
  const approve = useMutation({
    mutationFn: (id: string) =>
      api.post(`/academics/reexams/${id}/decision`, { approve: true, note: null }),
    onSettled: refresh,
  });
  const [marking, setMarking] = useState<ReexamItem | null>(null);
  const [sendingBack, setSendingBack] = useState<ReexamItem | null>(null);
  const b = q.data;
  const error = q.error ?? ask.error ?? approve.error;
  const term = (n: number) => en.examResults.term(termKind, n);
  return (
    <Section id="reexams" title={t.title} description={t.lead} flush>
      {!b ? null : b.failed.length === 0 && b.reexams.length === 0 ? (
        <EmptyState icon={RotateCcw} area="violet" title={t.none} compact />
      ) : (
        <div className="flex flex-col">
          {b.failed.length > 0 && (
            <>
              <h3 className="px-6 pt-1 pb-2 text-caption font-semibold tracking-wide text-ink-muted uppercase">
                {t.failed}
              </h3>
              <ul className="divide-y divide-line border-y border-line">
                {b.failed.map((f) => (
                  <li
                    key={`${f.term}:${f.studentId}:${f.courseId}`}
                    className="flex flex-wrap items-center gap-3 px-6 py-3"
                  >
                    <span className="min-w-0 flex-1 text-body text-ink">
                      <span className="font-medium">{f.name}</span> · {f.code} {f.title}
                      <span className="block text-caption text-ink-muted">
                        {term(f.term)} · {t.grade(f.grade)}
                      </span>
                    </span>
                    {canManage && (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={t.registerFor(t.kinds.supplementary ?? '', f.name, f.code)}
                        disabled={ask.isPending}
                        onClick={() =>
                          ask.mutate({
                            term: f.term,
                            studentId: f.studentId,
                            courseId: f.courseId,
                            kind: 'supplementary',
                          })
                        }
                      >
                        {t.registerSupplementary}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.reexams.length > 0 && (
            <ul className="divide-y divide-line">
              {b.reexams.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-3 px-6 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-body text-ink">
                      <span className="font-medium">{x.name}</span>
                      <span>
                        · {x.code} {x.title}
                      </span>
                      <Pill>{t.kinds[x.kind]}</Pill>
                      <Pill tone={STATE_TONE[x.state] ?? 'neutral'}>{t.states[x.state]}</Pill>
                    </p>
                    <p className="tabular text-caption text-ink-muted">
                      {term(x.term)} ·{' '}
                      {x.grade === null
                        ? t.grade(x.oldGrade)
                        : t.change(x.oldGrade, x.grade, x.absent ? t.absent : String(x.total))}
                    </p>
                    {x.state === 'marked' && x.approval?.status === 'pending' && (
                      <p className="text-caption text-ink-muted">
                        {en.workflow.progress(
                          x.approval.step,
                          x.approval.steps,
                          x.approval.stepRoleName ?? en.workflow.anyApprover,
                        )}
                      </p>
                    )}
                    {x.state === 'rejected' && x.decisionNote && (
                      <p className="text-caption text-signal-warn-ink">{x.decisionNote}</p>
                    )}
                  </div>
                  <span className="flex flex-wrap gap-2">
                    {canMark && (x.state === 'requested' || x.state === 'marked') && (
                      <Button
                        size="sm"
                        variant={x.state === 'requested' ? 'primary' : 'secondary'}
                        aria-label={t.markFor(x.name, x.code)}
                        onClick={() => setMarking(x)}
                      >
                        {x.state === 'requested' ? t.mark : t.remark}
                      </Button>
                    )}
                    {x.state === 'marked' && x.approval?.mine && (
                      <>
                        <Button
                          size="sm"
                          aria-label={t.approveFor(x.name, x.code)}
                          disabled={approve.isPending}
                          onClick={() => approve.mutate(x.id)}
                        >
                          {en.examResults.approve}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={t.sendBackFor(x.name, x.code)}
                          onClick={() => setSendingBack(x)}
                        >
                          {en.examResults.sendBack}
                        </Button>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="px-6 pb-4 text-caption text-signal-stop-ink">
          {errorText(error)}
        </p>
      )}
      {marking && b && (
        <MarkForm
          item={marking}
          seeMax={b.seeMax ?? 100}
          onClose={() => setMarking(null)}
          onDone={async () => (setMarking(null), await refresh())}
        />
      )}
      {sendingBack && (
        <SendBack
          item={sendingBack}
          onClose={() => setSendingBack(null)}
          onDone={async () => (setSendingBack(null), await refresh())}
        />
      )}
    </Section>
  );
}

function MarkForm({
  item,
  seeMax,
  onClose,
  onDone,
}: {
  item: ReexamItem;
  seeMax: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [see, setSee] = useState('');
  const [absent, setAbsent] = useState(false);
  const value = see.trim() === '' ? null : Number(see);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/reexams/${item.id}/mark`, { see: absent ? null : value, absent }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.markTitle(item.name, item.code)}
      description={`${t.kinds[item.kind]} · ${t.kindLead[item.kind]}`}
      submitLabel={t.sendForApproval}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={
        !absent && (value === null || Number.isNaN(value) || value < 0 || value > seeMax)
      }
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={t.see(seeMax)}>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          max={seeMax}
          step={0.25}
          disabled={absent}
          value={absent ? '' : see}
          onChange={(e) => setSee(e.target.value)}
          className={`${fieldInput} tabular`}
        />
      </ModalField>
      <label className="flex items-center gap-2 self-end pb-2 text-body text-ink">
        <input
          type="checkbox"
          checked={absent}
          onChange={(e) => setAbsent(e.target.checked)}
          className="size-4 accent-navy-950"
        />
        {t.absentLabel}
      </label>
    </FormModal>
  );
}

function SendBack({
  item,
  onClose,
  onDone,
}: {
  item: ReexamItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () => api.post(`/academics/reexams/${item.id}/decision`, { approve: false, note }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.sendBackTitle}
      description={`${item.name} · ${item.code}`}
      submitLabel={en.examResults.sendBack}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!note.trim()}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={en.examResults.why} wide>
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
