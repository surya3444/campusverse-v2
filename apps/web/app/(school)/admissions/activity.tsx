'use client';

// Logging what happened with a family (a call, a message, a visit, a note), optionally with the
// next follow-up, and marking a follow-up done. Both open in a FormModal.
import { FormModal, ModalField, cx } from '@campusverse/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Footprints,
  Mail,
  MessageCircle,
  MessageSquareText,
  NotebookPen,
  Phone,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { admissionError, c, field, plusDays } from './shared';

type Kind = 'call' | 'whatsapp' | 'sms' | 'email' | 'visit' | 'note';
export const KIND_ICON: Record<string, LucideIcon> = {
  call: Phone,
  whatsapp: MessageCircle,
  sms: MessageSquareText,
  email: Mail,
  visit: Footprints,
  note: NotebookPen,
};
const OUTCOMES: Record<Kind, string[]> = {
  call: ['reached', 'interested', 'call_back', 'no_answer', 'busy', 'not_interested'],
  whatsapp: ['reached', 'interested', 'call_back', 'not_interested'],
  sms: ['reached', 'interested', 'not_interested'],
  email: ['reached', 'interested', 'not_interested'],
  visit: ['visited', 'interested', 'not_interested'],
  note: [],
};

function Choice<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
  icons,
  label,
}: {
  legend: string;
  name: string;
  value: T | '';
  options: readonly T[];
  onChange: (v: T) => void;
  icons?: Record<string, LucideIcon>;
  label: (v: T) => string;
}) {
  return (
    <fieldset className="col-span-full flex flex-col gap-2">
      <legend className="mb-1.5 text-caption font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const Icon = icons?.[o];
          const on = value === o;
          return (
            <label
              key={o}
              className={cx(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-body font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy-950',
                on
                  ? 'border-navy-950 bg-navy-50 text-navy-950'
                  : 'border-line text-ink hover:border-line-strong',
              )}
            >
              <input
                type="radio"
                name={name}
                value={o}
                checked={on}
                onChange={() => onChange(o)}
                className="sr-only"
              />
              {Icon && <Icon aria-hidden className="size-4" />}
              {label(o)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function LogActivityDialog({
  applicationId,
  childName,
  onClose,
  onDone,
}: {
  applicationId: string;
  childName: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('call');
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [next, setNext] = useState(false);
  const [dueOn, setDueOn] = useState(plusDays(2));
  const [purpose, setPurpose] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/admissions/applications/${applicationId}/activity`, {
        kind,
        outcome: outcome || null,
        note: note.trim() || null,
        followUp: next ? { dueOn, purpose: purpose.trim() || c.log.defaultPurpose } : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admissions'] });
      void qc.invalidateQueries({ queryKey: ['application', applicationId] });
      void qc.invalidateQueries({ queryKey: ['admission-follow-ups'] });
      onDone?.();
      onClose();
    },
  });
  return (
    <FormModal
      title={c.log.title(childName)}
      submitLabel={c.log.save}
      cancelLabel={en.form.cancel}
      size="lg"
      pending={save.isPending}
      submitDisabled={!outcome && !note.trim()}
      error={save.error ? admissionError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <Choice
        legend={c.log.kind}
        name="log-kind"
        value={kind}
        options={['call', 'whatsapp', 'sms', 'email', 'visit', 'note'] as const}
        icons={KIND_ICON}
        label={(k) => c.kinds[k] ?? k}
        onChange={(k) => {
          setKind(k);
          setOutcome('');
        }}
      />
      {OUTCOMES[kind].length > 0 && (
        <Choice
          legend={c.log.outcome}
          name="log-outcome"
          value={outcome}
          options={OUTCOMES[kind]}
          label={(o) => c.outcomes[o] ?? o}
          onChange={setOutcome}
        />
      )}
      <ModalField label={c.notes} hint={c.optional} wide>
        <textarea
          rows={3}
          maxLength={1000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={cx(field, 'h-auto py-2')}
        />
      </ModalField>
      <label className="col-span-full flex items-center gap-2.5 text-body text-ink">
        <input
          type="checkbox"
          checked={next}
          onChange={(e) => setNext(e.target.checked)}
          className="size-4 accent-[#04266d]"
        />
        {c.log.scheduleNext}
      </label>
      {next && (
        <>
          <ModalField label={c.followUps.due}>
            <input
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              className={field}
            />
          </ModalField>
          <ModalField label={c.followUps.purpose}>
            <input
              value={purpose}
              maxLength={200}
              placeholder={c.log.defaultPurpose}
              onChange={(e) => setPurpose(e.target.value)}
              className={field}
            />
          </ModalField>
        </>
      )}
    </FormModal>
  );
}

/** A follow-up done: what happened, and optionally the next one. */
export function CompleteFollowUpDialog({
  followUpId,
  childName,
  purpose,
  onClose,
}: {
  followUpId: string;
  childName: string;
  purpose: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState('');
  const [next, setNext] = useState(false);
  const [dueOn, setDueOn] = useState(plusDays(3));
  const [nextPurpose, setNextPurpose] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/school/admissions/follow-ups/${followUpId}/done`, {
        outcome: outcome.trim(),
        next: next ? { dueOn, purpose: nextPurpose.trim() || c.log.defaultPurpose } : null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admission-follow-ups'] });
      void qc.invalidateQueries({ queryKey: ['admissions'] });
      void qc.invalidateQueries({ queryKey: ['application'] });
      onClose();
    },
  });
  return (
    <FormModal
      title={c.followUps.doneTitle(childName)}
      description={purpose}
      submitLabel={c.followUps.markDone}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={outcome.trim().length < 2}
      error={save.error ? admissionError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <div className="col-span-full flex flex-wrap gap-2">
        {c.followUps.quick.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setOutcome(q)}
            className={cx(
              'rounded-lg border px-3 py-1.5 text-caption font-medium transition-colors',
              outcome === q
                ? 'border-navy-950 bg-navy-50 text-navy-950'
                : 'border-line text-ink hover:border-line-strong',
            )}
          >
            {q}
          </button>
        ))}
      </div>
      <ModalField label={c.followUps.outcome} wide>
        <textarea
          rows={3}
          maxLength={500}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className={cx(field, 'h-auto py-2')}
        />
      </ModalField>
      <label className="col-span-full flex items-center gap-2.5 text-body text-ink">
        <input
          type="checkbox"
          checked={next}
          onChange={(e) => setNext(e.target.checked)}
          className="size-4 accent-[#04266d]"
        />
        {c.log.scheduleNext}
      </label>
      {next && (
        <>
          <ModalField label={c.followUps.due}>
            <input
              type="date"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              className={field}
            />
          </ModalField>
          <ModalField label={c.followUps.purpose}>
            <input
              value={nextPurpose}
              maxLength={200}
              placeholder={c.log.defaultPurpose}
              onChange={(e) => setNextPurpose(e.target.value)}
              className={field}
            />
          </ModalField>
        </>
      )}
    </FormModal>
  );
}
