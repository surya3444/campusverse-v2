'use client';

// A student's register details (docs/specs/CONNECTED_SCHOOL.md): what the admission register,
// UDISE+, transfer certificates and scholarships ask for. Shown to people with the full record;
// edited in a modal by people who can update the student.
import type { StudentDetails } from '@campusverse/people-records';
import { Button, FormModal, ModalField, Section } from '@campusverse/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { fieldInput } from '../../common/custom-fields';

const t = en.students.details;
const KEYS: (keyof StudentDetails)[] = [
  'bloodGroup',
  'motherTongue',
  'religion',
  'socialCategory',
  'nationality',
  'placeOfBirth',
  'addressLine',
  'city',
  'pincode',
  'stateCode',
  'previousSchool',
  'disability',
  'medicalNotes',
];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const shown = (k: keyof StudentDetails, v: string | null) =>
  !v
    ? null
    : k === 'socialCategory'
      ? (t.categories[v] ?? v)
      : k === 'stateCode'
        ? (t.states[v] ?? v)
        : v;

export function DetailsPanel({
  studentId,
  details,
  canEdit,
  onMessage,
}: {
  studentId: string;
  details: StudentDetails;
  canEdit: boolean;
  onMessage: (m: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Section
      id="student-details"
      title={t.title}
      description={t.lead}
      flush
      actions={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden className="size-4" />
            {t.edit}
          </Button>
        ) : undefined
      }
    >
      <dl className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
        {KEYS.map((k) => (
          <div key={k} className="flex flex-col gap-0.5 border-line px-5 py-3 sm:border-b">
            <dt className="text-caption text-ink-muted">{t.fields[k]}</dt>
            <dd className="text-body text-ink">
              {shown(k, details[k]) ?? <span className="text-ink-muted">{t.none}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {editing && (
        <DetailsModal
          studentId={studentId}
          details={details}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            onMessage(t.saved);
          }}
        />
      )}
    </Section>
  );
}

function DetailsModal({
  studentId,
  details,
  onClose,
  onDone,
}: {
  studentId: string;
  details: StudentDetails;
  onClose: () => void;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>(
    Object.fromEntries(KEYS.map((k) => [k, details[k] ?? ''])),
  );
  const save = useMutation({
    mutationFn: () => api.post(`/people/students/${studentId}/details`, form),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['student', studentId] });
      onDone();
    },
  });
  const set = (k: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const text = (k: keyof StudentDetails, max: number, wide = false) => (
    <ModalField key={k} label={t.fields[k] ?? k} wide={wide}>
      <input maxLength={max} value={form[k] ?? ''} onChange={set(k)} className={fieldInput} />
    </ModalField>
  );
  const pick = (k: keyof StudentDetails, options: [string, string][]) => (
    <ModalField key={k} label={t.fields[k] ?? k}>
      <select value={form[k] ?? ''} onChange={set(k)} className={fieldInput}>
        <option value="">{t.none}</option>
        {options.map(([v, label]) => (
          <option key={v} value={v}>
            {label}
          </option>
        ))}
      </select>
    </ModalField>
  );
  return (
    <FormModal
      title={t.edit}
      description={t.sensitive}
      submitLabel={t.save}
      cancelLabel={en.preview.cancel}
      size="lg"
      pending={save.isPending}
      error={
        save.error
          ? save.error instanceof ApiFailure && save.error.status === 403
            ? en.states.denied.title
            : en.states.error.title
          : null
      }
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {pick(
        'bloodGroup',
        BLOOD.map((b) => [b, b]),
      )}
      {text('motherTongue', 40)}
      {text('religion', 40)}
      {pick('socialCategory', Object.entries(t.categories))}
      {text('nationality', 40)}
      {text('placeOfBirth', 80)}
      {text('addressLine', 300, true)}
      {text('city', 80)}
      <ModalField label={t.fields.pincode ?? ''}>
        <input
          inputMode="numeric"
          pattern="[1-9][0-9]{5}"
          maxLength={6}
          value={form.pincode ?? ''}
          onChange={set('pincode')}
          className={fieldInput}
        />
      </ModalField>
      {pick('stateCode', Object.entries(t.states))}
      {text('previousSchool', 160, true)}
      {text('disability', 200, true)}
      <ModalField label={t.fields.medicalNotes ?? ''} wide>
        <textarea
          rows={3}
          maxLength={500}
          value={form.medicalNotes ?? ''}
          onChange={set('medicalNotes')}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
