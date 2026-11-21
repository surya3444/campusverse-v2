'use client';

// Change section (owner's brief, 20 Nov 2026): only sections of the same class and year, with
// headcount and seats left; from tomorrow by default, today only when neither register is taken;
// the next roll number in the new section. Attendance already taken stays where it was.
import { FormModal, ModalField, Pill, cx } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { formatDate } from '../../setup/shared';

const t = en.students.p360.changeSection;

// Mirrors SectionOptions in @campusverse/school-enrolment (the web app doesn't depend on it).
type Options = {
  today: string;
  current: {
    sectionId: string;
    label: string;
    rollNumber: number | null;
    yearLabel: string;
    yearEnds: string;
  };
  options: {
    sectionId: string;
    label: string;
    students: number;
    capacity: number;
    closed: boolean;
    classTeacher: string | null;
    nextRoll: number;
    earliest: string;
  }[];
};

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export function ChangeSectionDialog({
  personId,
  name,
  onClose,
  onDone,
}: {
  personId: string;
  name: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const data = useQuery({
    queryKey: ['section-options', personId],
    queryFn: () => api.get<Options>(`/school/enrolment/${personId}/section-options`),
  });
  if (!data.data)
    return (
      <FormModal
        title={t.title}
        submitLabel={t.submit}
        cancelLabel={en.form.cancel}
        submitDisabled
        onClose={onClose}
        onSubmit={onClose}
      >
        <p className="col-span-full text-body text-ink-muted" aria-live="polite">
          {data.isError ? errorText(data.error) : en.states.loading.title}
        </p>
      </FormModal>
    );
  return <Form personId={personId} name={name} o={data.data} onClose={onClose} onDone={onDone} />;
}

function errorText(e: unknown) {
  const code = e instanceof ApiFailure ? e.code : 'error';
  return t.errors[code] ?? t.errors.error;
}

function Form({
  personId,
  name,
  o,
  onClose,
  onDone,
}: {
  personId: string;
  name: string;
  o: Options;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  const open = o.options.filter((x) => !x.closed);
  const [sectionId, setSectionId] = useState(open.length === 1 ? (open[0]?.sectionId ?? '') : '');
  const tomorrow = addDays(o.today, 1);
  const lastDay = addDays(o.current.yearEnds, -1);
  const [from, setFrom] = useState(tomorrow);
  const [reason, setReason] = useState('');
  const chosen = o.options.find((x) => x.sectionId === sectionId);
  const min = chosen?.earliest ?? o.today;
  const dateOk = from >= min && from <= lastDay;
  const save = useMutation({
    mutationFn: () =>
      api.post<{ rollNumber: number | null }>('/school/enrolment/change-section', {
        personId,
        sectionId,
        from,
        reason: reason.trim(),
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['student', personId] });
      void qc.invalidateQueries({ queryKey: ['section-options', personId] });
      void qc.invalidateQueries({ queryKey: ['stamps'] });
      onDone(t.done(name, chosen?.label ?? '', formatDate(from), r.rollNumber));
    },
  });
  const failure = save.error instanceof ApiFailure ? save.error : null;
  const takenDays =
    failure?.code === 'attendance_taken'
      ? ((failure.details as { days?: string[] } | null)?.days ?? [])
      : [];

  if (o.options.length === 0)
    return (
      <FormModal
        title={t.title}
        submitLabel={t.submit}
        cancelLabel={en.form.cancel}
        submitDisabled
        onClose={onClose}
        onSubmit={onClose}
      >
        <p className="col-span-full text-body text-ink">{t.noOther(o.current.label)}</p>
      </FormModal>
    );

  return (
    <FormModal
      title={t.title}
      description={t.lead(name, o.current.label, o.current.yearLabel)}
      submitLabel={t.submit}
      cancelLabel={en.form.cancel}
      size="lg"
      pending={save.isPending}
      submitDisabled={!chosen || chosen.closed || !dateOk || reason.trim().length < 3}
      error={save.error && takenDays.length === 0 ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <fieldset className="col-span-full flex flex-col gap-2">
        <legend className="mb-2 text-caption font-medium text-ink">{t.to}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {o.options.map((x) => {
            const left = x.capacity - x.students;
            const picked = x.sectionId === sectionId;
            return (
              <label
                key={x.sectionId}
                className={cx(
                  'flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-navy-950',
                  picked ? 'border-navy-950 bg-navy-50/60' : 'border-line hover:bg-paper',
                  x.closed && 'cursor-not-allowed opacity-60',
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="section"
                    value={x.sectionId}
                    checked={picked}
                    disabled={x.closed}
                    onChange={() => {
                      setSectionId(x.sectionId);
                      if (from < x.earliest) setFrom(x.earliest);
                    }}
                    className="size-4 accent-[#04266d]"
                  />
                  <span className="font-heading text-body font-semibold text-ink">{x.label}</span>
                  <span className="flex-1" />
                  {x.closed ? (
                    <Pill tone="neutral">{t.closed}</Pill>
                  ) : left <= 0 ? (
                    <Pill tone="warn">{t.full}</Pill>
                  ) : (
                    <Pill tone="go">{t.seatsLeft(left)}</Pill>
                  )}
                </span>
                <span className="tabular text-caption text-ink-muted">
                  {t.headcount(x.students, x.capacity)}
                </span>
                <span className="text-caption text-ink-muted">
                  {x.classTeacher ? t.teacher(x.classTeacher) : t.noTeacher}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {chosen && chosen.capacity - chosen.students <= 0 && (
        <p className="col-span-full rounded-lg bg-signal-warn-tint px-3 py-2 text-caption text-signal-warn-ink">
          {t.overCapacity(chosen.label)}
        </p>
      )}
      <ModalField label={t.from} hint={t.fromHint}>
        <input
          type="date"
          value={from}
          min={min}
          max={lastDay}
          onChange={(e) => setFrom(e.target.value)}
          className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950"
        />
      </ModalField>
      <div className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-ink">{t.roll}</span>
        <p className="tabular flex h-10 items-center text-body text-ink" aria-live="polite">
          {chosen
            ? t.rollPreview(chosen.nextRoll, chosen.label, o.current.rollNumber, o.current.label)
            : t.pickFirst}
        </p>
      </div>
      <ModalField label={t.reason} wide>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder={t.reasonHint}
          className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-body text-ink outline-none focus:border-navy-950"
        />
      </ModalField>
      {takenDays.length > 0 && (
        <div
          role="alert"
          className="col-span-full rounded-lg bg-signal-stop-tint px-3 py-2 text-caption text-signal-stop-ink"
        >
          <p className="font-medium">{t.takenTitle}</p>
          <p className="tabular">{takenDays.map((d) => formatDate(d)).join(', ')}</p>
          <p>{t.takenHint(formatDate(addDays(takenDays.at(-1) ?? o.today, 1)))}</p>
        </div>
      )}
      <p className="col-span-full text-caption text-ink-muted">{t.note}</p>
    </FormModal>
  );
}
