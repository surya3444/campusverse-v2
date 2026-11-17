'use client';

import type { Field } from '@campusverse/platform-fields';
import {
  Button,
  EmptyState,
  FormModal,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, RotateCcw, Archive } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { RecordStamp } from '../../common/activity';
import { CustomFields, fieldInput, type Values } from '../../common/custom-fields';
import { SettingsFrame } from '../frame';

const t = en.fieldsAdmin;
// In the owner's order of importance (6 November).
const ENTITIES = [
  'organisation',
  'campus',
  'institution',
  'admission',
  'staff',
  'student',
  'guardian',
];
const CHOICES = new Set(['choice', 'multi_choice']);

type Draft = {
  id: string | null;
  label: string;
  type: string;
  options: string;
  required: boolean;
  help: string;
  section: string;
};
const blank: Draft = {
  id: null,
  label: '',
  type: 'text',
  options: '',
  required: false,
  help: '',
  section: '',
};

export function FieldsView() {
  const qc = useQueryClient();
  const [entity, setEntity] = useState('organisation');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState<Values>({});
  const [notice, setNotice] = useState<string | null>(null);
  const counts = useQuery({
    queryKey: ['fields-counts'],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          ENTITIES.map(async (e) => [e, (await api.get<Field[]>(`/fields/${e}`)).length] as const),
        ),
      ),
  });
  const list = useQuery({
    queryKey: ['fields', entity, 'all'],
    queryFn: () => api.get<Field[]>(`/fields/${entity}?retired=1`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['fields'] });
    void qc.invalidateQueries({ queryKey: ['fields-counts'] });
  };
  const errorText = (e: unknown): string =>
    (e instanceof ApiFailure
      ? e.status === 403
        ? t.errors.forbidden
        : (t.errors[e.code] ?? t.errors.error)
      : t.errors.error) ?? '';

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const body = {
        label: d.label,
        options: CHOICES.has(d.type)
          ? d.options
              .split('\n')
              .map((o) => o.trim())
              .filter(Boolean)
          : [],
        required: d.required,
        help: d.help || null,
        section: d.section || null,
      };
      return d.id
        ? api.post(`/fields/item/${d.id}`, body)
        : api.post(`/fields/${entity}`, { ...body, type: d.type });
    },
    onSuccess: () => {
      setDraft(null);
      setNotice(t.saved);
      refresh();
    },
  });
  const retire = useMutation({
    mutationFn: ({ id, retired }: { id: string; retired: boolean }) =>
      api.post(`/fields/item/${id}/retire`, { retired }),
    onSuccess: refresh,
  });
  const order = useMutation({
    mutationFn: (ids: string[]) => api.post(`/fields/${entity}/order`, { ids }),
    onSuccess: refresh,
  });

  const active = (list.data ?? []).filter((f) => !f.retired);
  const retired = (list.data ?? []).filter((f) => f.retired);
  const move = (i: number, by: number) => {
    const ids = active.map((f) => f.id);
    const [x] = ids.splice(i, 1);
    if (x) ids.splice(i + by, 0, x);
    order.mutate(ids);
  };

  return (
    <SettingsFrame title={t.title} lead={t.lead}>
      <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label={t.title} className="panel p-2 lg:sticky lg:top-24">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {ENTITIES.map((e) => (
              <li key={e} className="shrink-0">
                <button
                  type="button"
                  aria-current={e === entity ? 'true' : undefined}
                  onClick={() => {
                    setEntity(e);
                    setDraft(null);
                    setPreview({});
                  }}
                  className={cx(
                    'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-body transition-colors',
                    e === entity
                      ? 'bg-navy-50 font-semibold text-navy-950'
                      : 'text-ink hover:bg-paper',
                  )}
                >
                  {t.entities[e]}
                  <span className="tabular rounded-full bg-surface px-2 text-caption text-ink-muted ring-1 ring-line">
                    {counts.data?.[e] ?? '·'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lead font-semibold text-ink">{t.entities[entity]}</h2>
              <p className="text-body text-ink-muted">{t.entityLead[entity]}</p>
            </div>
            {!draft && (
              <Button onClick={() => setDraft(blank)}>
                <Plus aria-hidden className="size-4" />
                {t.add}
              </Button>
            )}
          </div>

          {draft && (
            <FormModal
              title={draft.id ? `${t.edit}: ${draft.label}` : t.add}
              description={t.entities[entity]}
              submitLabel={draft.id ? t.save : t.create}
              cancelLabel={t.cancel}
              pending={save.isPending}
              error={save.isError ? errorText(save.error) : null}
              onClose={() => {
                save.reset();
                setDraft(null);
              }}
              onSubmit={() => save.mutate(draft)}
            >
              <>
                <Labelled label={t.label} hint={t.labelHint}>
                  <input
                    required
                    maxLength={80}
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                    className={fieldInput}
                  />
                </Labelled>
                <Labelled label={t.type}>
                  <select
                    value={draft.type}
                    disabled={!!draft.id}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                    className={fieldInput}
                  >
                    {Object.entries(t.types).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Labelled>
                {CHOICES.has(draft.type) && (
                  <Labelled label={t.options} hint={t.optionsHint} wide>
                    <textarea
                      required
                      rows={4}
                      value={draft.options}
                      onChange={(e) => setDraft({ ...draft, options: e.target.value })}
                      className={cx(fieldInput, 'h-auto py-2')}
                    />
                  </Labelled>
                )}
                <Labelled label={t.help} hint={t.helpHint}>
                  <input
                    maxLength={200}
                    value={draft.help}
                    onChange={(e) => setDraft({ ...draft, help: e.target.value })}
                    className={fieldInput}
                  />
                </Labelled>
                <Labelled label={t.section} hint={t.sectionHint}>
                  <input
                    maxLength={60}
                    value={draft.section}
                    onChange={(e) => setDraft({ ...draft, section: e.target.value })}
                    className={fieldInput}
                  />
                </Labelled>
                <label className="flex items-start gap-3 sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={draft.required}
                    onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
                    className="mt-1 size-4 accent-navy-950"
                  />
                  <span className="flex flex-col">
                    <span className="text-body font-medium text-ink">{t.required}</span>
                    <span className="text-caption text-ink-muted">{t.requiredHint}</span>
                  </span>
                </label>
              </>
            </FormModal>
          )}

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section aria-label={t.entities[entity]} className="panel overflow-hidden">
              {list.isPending ? (
                <div className="p-5">
                  <SkeletonRows rows={3} label={en.states.loading.title} />
                </div>
              ) : list.isError ? (
                <StatePanel kind="error" title={errorText(list.error)} />
              ) : active.length === 0 ? (
                <EmptyState compact art="empty" title={t.none} body={t.noneBody} />
              ) : (
                <ol className="divide-y divide-line">
                  {active.map((f, i) => (
                    <li key={f.id} className="flex flex-col gap-2 px-5 py-4">
                      <div className="flex items-start gap-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="text-body font-semibold text-ink">{f.label}</span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Pill>{t.types[f.type]}</Pill>
                            {f.required && <Pill tone="warn">{t.required}</Pill>}
                            {f.section && <Pill>{f.section}</Pill>}
                            <span className="text-caption text-ink-muted">{t.key(f.key)}</span>
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <IconButton
                            label={t.moveUp(f.label)}
                            disabled={i === 0 || order.isPending}
                            onClick={() => move(i, -1)}
                            icon={ArrowUp}
                          />
                          <IconButton
                            label={t.moveDown(f.label)}
                            disabled={i === active.length - 1 || order.isPending}
                            onClick={() => move(i, 1)}
                            icon={ArrowDown}
                          />
                          <IconButton
                            label={`${t.edit}: ${f.label}`}
                            onClick={() =>
                              setDraft({
                                id: f.id,
                                label: f.label,
                                type: f.type,
                                options: f.options.join('\n'),
                                required: f.required,
                                help: f.help ?? '',
                                section: f.section ?? '',
                              })
                            }
                            icon={Pencil}
                          />
                          <IconButton
                            label={`${t.retire}: ${f.label}`}
                            onClick={() => retire.mutate({ id: f.id, retired: true })}
                            icon={Archive}
                          />
                        </div>
                      </div>
                      <RecordStamp id={f.id} />
                    </li>
                  ))}
                </ol>
              )}
              {retired.length > 0 && (
                <details className="border-t border-line bg-paper/60">
                  <summary className="cursor-pointer px-5 py-3 text-body font-medium text-ink-muted">
                    {t.retired} ({retired.length})
                  </summary>
                  <p className="px-5 pb-2 text-caption text-ink-muted">{t.retiredHint}</p>
                  <ul className="divide-y divide-line">
                    {retired.map((f) => (
                      <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                        <span className="flex-1 text-body text-ink-muted line-through">
                          {f.label}
                        </span>
                        <Button
                          variant="quiet"
                          onClick={() => retire.mutate({ id: f.id, retired: false })}
                        >
                          <RotateCcw aria-hidden className="size-4" />
                          {t.restore}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            {active.length > 0 && (
              <Section title={t.preview}>
                <CustomFields
                  fields={active}
                  values={preview}
                  onChange={(k, v) => setPreview((p) => ({ ...p, [k]: v }))}
                  idPrefix="preview"
                  oneColumn
                />
              </Section>
            )}
          </div>
          <p role="status" className="sr-only">
            {notice}
          </p>
        </div>
      </div>
    </SettingsFrame>
  );
}

function Labelled({
  label,
  hint,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={cx('flex flex-col gap-1.5', wide && 'sm:col-span-2')}>
      <span className="text-caption font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="text-caption text-ink-muted">{hint}</span>}
    </label>
  );
}

function IconButton({
  label,
  icon: Icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-navy-50 hover:text-navy-950 disabled:opacity-30"
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
