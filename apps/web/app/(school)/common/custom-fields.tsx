'use client';

// Owner-defined fields on any form (decision 0020): the definitions come from /fields/<entity>,
// the values from the record. The server checks every value again against its definition.
import type { Field } from '@campusverse/platform-fields';
import { cx } from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { Fragment } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';

const t = en.customFields;
export const fieldInput =
  'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-body text-ink shadow-[var(--shadow-card)] outline-none focus:border-navy-950 aria-[invalid=true]:border-signal-stop';
/** The same field sized by its content or a width you give (filters, side-by-side fields). */
export const fieldInline = fieldInput.replace('w-full ', '');

export type Values = Record<string, unknown>;

export function useFields(entity: string) {
  return useQuery({
    queryKey: ['fields', entity],
    queryFn: () => api.get<Field[]>(`/fields/${entity}`),
  });
}

/** The keys whose value differs from what was saved. */
export function changedValues(fields: Field[], saved: Values, draft: Values): Values {
  return Object.fromEntries(
    fields
      .filter((f) => JSON.stringify(draft[f.key] ?? null) !== JSON.stringify(saved[f.key] ?? null))
      .map((f) => [f.key, draft[f.key] ?? null]),
  );
}

/** Renders an entity's own fields, grouped by section, in the owner's order. */
export function CustomFields({
  fields,
  values,
  onChange,
  problems = {},
  disabled = false,
  idPrefix = 'cf',
  oneColumn = false,
}: {
  fields: Field[];
  values: Values;
  onChange: (key: string, value: unknown) => void;
  problems?: Record<string, string>;
  disabled?: boolean;
  idPrefix?: string;
  /** For narrow places, such as a preview beside a list. */
  oneColumn?: boolean;
}) {
  if (fields.length === 0) return null;
  const sections = [...new Set(fields.map((f) => f.section ?? ''))];
  return (
    <div className="flex flex-col gap-6">
      {sections.map((s) => (
        <Fragment key={s}>
          {s && <p className="-mb-2 text-caption font-semibold text-ink-muted">{s}</p>}
          <div className={cx('grid gap-4', !oneColumn && 'sm:grid-cols-2 lg:grid-cols-3')}>
            {fields
              .filter((f) => (f.section ?? '') === s)
              .map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={values[f.key]}
                  onChange={(v) => onChange(f.key, v)}
                  problem={problems[f.key]}
                  disabled={disabled}
                  id={`${idPrefix}-${f.key}`}
                />
              ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function FieldInput({
  field: f,
  value,
  onChange,
  problem,
  disabled,
  id,
}: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  problem: string | undefined;
  disabled: boolean;
  id: string;
}) {
  const hint = problem ? t.problems[problem] : f.help;
  const describedBy = hint ? `${id}-hint` : undefined;
  const common = {
    id,
    disabled,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': describedBy,
    required: f.required,
  };
  const text = typeof value === 'string' ? value : '';
  let control;
  switch (f.type) {
    case 'long_text':
      control = (
        <textarea
          {...common}
          rows={3}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={cx(fieldInput, 'h-auto py-2')}
        />
      );
      break;
    case 'yes_no':
      control = (
        <select
          {...common}
          value={value === true ? 'yes' : value === false ? 'no' : ''}
          onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}
          className={fieldInput}
        >
          <option value="">{t.choose}</option>
          <option value="yes">{t.yes}</option>
          <option value="no">{t.no}</option>
        </select>
      );
      break;
    case 'choice':
      control = (
        <select
          {...common}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={fieldInput}
        >
          <option value="">{t.choose}</option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      );
      break;
    case 'multi_choice': {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      control = (
        <div
          role="group"
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy}
          className="flex flex-wrap gap-2"
        >
          {f.options.map((o) => {
            const on = chosen.includes(o);
            return (
              <button
                key={o}
                type="button"
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onChange(on ? chosen.filter((c) => c !== o) : [...chosen, o])}
                className={cx(
                  'rounded-full border px-3 py-1.5 text-body transition-colors',
                  on
                    ? 'border-navy-950 bg-navy-50 font-medium text-navy-950'
                    : 'border-line-strong bg-surface text-ink hover:border-navy-200',
                )}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    default:
      control = (
        <input
          {...common}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={fieldInput}
          {...(f.type === 'number' ? { inputMode: 'decimal' as const } : {})}
          {...(f.type === 'date' ? { type: 'date' } : {})}
          {...(f.type === 'email' ? { type: 'email' } : {})}
          {...(f.type === 'phone' ? { type: 'tel', inputMode: 'tel' as const } : {})}
        />
      );
  }
  const wide = f.type === 'long_text' || f.type === 'multi_choice';
  return (
    <div className={cx('flex flex-col gap-1.5', wide && 'sm:col-span-2 lg:col-span-3')}>
      <label
        id={`${id}-label`}
        htmlFor={f.type === 'multi_choice' ? undefined : id}
        className="text-caption font-medium text-ink"
      >
        {f.label}
        {f.required && (
          <span aria-hidden className="text-signal-stop-ink">
            {' '}
            *
          </span>
        )}
      </label>
      {control}
      {hint && (
        <span
          id={`${id}-hint`}
          className={cx('text-caption', problem ? 'text-signal-stop-ink' : 'text-ink-muted')}
        >
          {hint}
        </span>
      )}
    </div>
  );
}
