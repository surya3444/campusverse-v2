'use client';

import type { MarksSheet } from '@campusverse/school-exams';
import { Announcer, Button, DataGrid, FormModal, StatePanel, checkMark } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ApiFailure, api } from '../../../../../lib/api';
import { en } from '../../../../../messages/en';
import { clock } from '../../../attendance/shared';
import { fieldInput } from '../../../common/custom-fields';
import { examError, t } from '../../shared';

const COL = 'mark';

export function MarksView({
  examId,
  paperId,
  sectionId,
}: {
  examId: string;
  paperId: string;
  sectionId: string;
}) {
  const qc = useQueryClient();
  const key = ['marks', paperId, sectionId];
  const sheet = useQuery({
    queryKey: key,
    queryFn: () => api.get<MarksSheet>(`/school/exams/papers/${paperId}?sectionId=${sectionId}`),
    enabled: !!paperId && !!sectionId,
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const [savedAt, setSavedAt] = useState<string>();
  const [saveError, setSaveError] = useState<unknown>(null);
  const [notice, setNotice] = useState('');
  const pending = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (sheet.data)
      setValues(Object.fromEntries(sheet.data.students.map((s) => [s.personId, s.mark])));
  }, [sheet.data]);

  // Cells the grid marks as wrong stay on screen until fixed; the rest are saved.
  const flush = async () => {
    const max = Number(sheet.data?.maxMarks ?? 0);
    const entries = [...pending.current]
      .map(([studentId, mark]) => ({ studentId, mark }))
      .filter((e) => checkMark(e.mark, max) === null);
    if (entries.length === 0) return;
    setSaveState('saving');
    try {
      await api.post(`/school/exams/papers/${paperId}/marks`, { sectionId, entries });
      for (const e of entries)
        if (pending.current.get(e.studentId) === e.mark) pending.current.delete(e.studentId);
      setSaveState('saved');
      setSavedAt(clock(new Date().toISOString()));
      setSaveError(null);
    } catch (e) {
      // A refused mark stays on screen with the reason; a lost connection retries when back.
      if (e instanceof ApiFailure) {
        setSaveState('saved');
        setSaveError(e);
      } else setSaveState('offline');
    }
  };
  useEffect(() => {
    const retry = () => void flush();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  });

  const submit = useMutation({
    mutationFn: async () => {
      clearTimeout(timer.current);
      await flush();
      await api.post(`/school/exams/papers/${paperId}/submit`, {});
    },
    onSuccess: () => {
      setNotice(t.submitted);
      void qc.invalidateQueries({ queryKey: key });
    },
  });

  if (!paperId || !sectionId || sheet.isPending)
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (sheet.isError)
    return sheet.error instanceof ApiFailure && sheet.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={examError(sheet.error)} />
    );
  const s = sheet.data;
  const max = Number(s.maxMarks);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/exams/${examId}`}
        className="flex w-fit items-center gap-1.5 text-caption text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {s.exam}
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-title font-semibold text-ink">
          {s.subject} · {s.section}
        </h1>
        {s.canEdit && !s.submitted && (
          <Button onClick={() => submit.mutate()} disabled={submit.isPending}>
            {t.submit(s.subject)}
          </Button>
        )}
      </div>
      {s.students.length === 0 ? (
        <StatePanel kind="empty" title={en.states.empty.title} />
      ) : s.canEdit ? (
        <>
          <p className="text-caption text-ink-muted">{t.codesHint}</p>
          <DataGrid
            columns={[{ id: COL, header: s.subject, max }]}
            rows={s.students.map((p) => ({
              id: p.personId,
              name: p.name,
              ...(p.rollNumber !== null ? { meta: String(p.rollNumber) } : {}),
              values: { [COL]: values[p.personId] ?? '' },
            }))}
            onChange={(rowId, _col, value) => {
              setValues((v) => ({ ...v, [rowId]: value }));
              pending.current.set(rowId, value);
              clearTimeout(timer.current);
              timer.current = setTimeout(() => void flush(), 600);
            }}
            saveState={saveState}
            {...(savedAt ? { savedAt } : {})}
            labels={{ ...en.grid, caption: t.gridCaption(s.exam, s.section) }}
          />
        </>
      ) : (
        <>
          <p className="text-caption text-ink-muted">{t.readOnly}</p>
          <ul className="panel divide-y divide-line">
            {s.students.map((p) => (
              <li key={p.personId} className="flex items-center gap-3 px-5 py-2.5">
                <span className="flex-1 text-ink">{p.name}</span>
                <span className="tabular-nums text-ink">{p.mark || '—'}</span>
              </li>
            ))}
          </ul>
          {s.examState === 'marks_locked' && <ChangeForm paperId={paperId} sheet={s} />}
        </>
      )}
      {(saveError ?? submit.error) && (
        <p role="alert" className="text-caption text-signal-stop-ink">
          {examError(saveError ?? submit.error)}
        </p>
      )}
      {notice && <Announcer message={notice} />}
    </div>
  );
}

function ChangeForm({ paperId, sheet }: { paperId: string; sheet: MarksSheet }) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState(sheet.students[0]?.personId ?? '');
  const [mark, setMark] = useState('');
  const [reason, setReason] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.post(`/school/exams/papers/${paperId}/changes`, { studentId, mark, reason }),
    onSuccess: () => {
      setMark('');
      setReason('');
      setOpen(false);
    },
  });
  return (
    <div className="panel flex flex-wrap items-center gap-3 p-5">
      <div className="min-w-0 flex-1">
        <h2 className="text-body font-semibold text-ink">{t.changeTitle}</h2>
        <p className="text-caption text-ink-muted">{t.changeHint}</p>
      </div>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {t.changeTitle}
      </Button>
      {send.isSuccess && <Announcer message={t.sent} />}
      {open && (
        <FormModal
          title={t.changeTitle}
          description={t.changeHint}
          submitLabel={t.send}
          cancelLabel={en.form.cancel}
          pending={send.isPending}
          error={send.isError ? examError(send.error) : null}
          onClose={() => {
            send.reset();
            setOpen(false);
          }}
          onSubmit={() => send.mutate()}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.student}</span>
            <select
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className={fieldInput}
            >
              {sheet.students.map((p) => (
                <option key={p.personId} value={p.personId}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.newMark}</span>
            <input
              required
              value={mark}
              onChange={(e) => setMark(e.target.value.toUpperCase())}
              className={fieldInput}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.reason}</span>
            <input
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={fieldInput}
            />
          </label>
        </FormModal>
      )}
    </div>
  );
}
