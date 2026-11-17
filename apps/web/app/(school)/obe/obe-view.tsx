'use client';

// Academics › OBE (rule book §13.2: Program Outcomes; Course Outcomes & Mapping; Attainment; P1 item
// 17): a programme's versioned outcomes, each course's COs with the CO–PO/PSO matrix and what
// measures them, and direct attainment for a published term. POs come only from CO levels through
// the matrix, against one target level, so the two never disagree.
import type { AttainmentView, CourseOutcomesView, OutcomeSet } from '@campusverse/academics-obe';
import type { RegulationView, StructureOverview } from '@campusverse/academics-structure';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Target, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { useUrlTab } from '../common/url-tab';

const t = en.obe;
type Tab = 'outcomes' | 'courses' | 'attainment';
const KINDS = ['peo', 'po', 'pso'] as const;
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
const level = (n: number | null) => (n === null ? '—' : n.toFixed(2));

export function ObeView() {
  const school = useInstitution();
  const id = school.institutionId;
  const { can } = useMe();
  const manage = can('academics.obe.manage');
  const [tab, setTab] = useUrlTab<Tab>(['outcomes', 'courses', 'attainment'], 'outcomes');
  const overview = useQuery({
    queryKey: ['academics', id],
    queryFn: () => api.get<StructureOverview>(`/academics/structure?institutionId=${id}`),
    enabled: !!id,
  });
  const programs = overview.data?.programs ?? [];
  const [chosen, setChosen] = useState<string | null>(null);
  const program = programs.find((p) => p.id === chosen) ?? programs[0];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Target}
        area="violet"
        eyebrow={en.systems.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          programs.length > 0 ? (
            <label className="flex items-center gap-2 text-body text-ink">
              <span className="text-caption font-medium text-ink-muted">{t.program}</span>
              <select
                value={program?.id}
                onChange={(e) => setChosen(e.target.value)}
                className={`${fieldInput} min-w-56`}
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      >
        {program && (
          <Segmented
            label={t.title}
            value={tab}
            onChange={setTab}
            options={(['outcomes', 'courses', 'attainment'] as const).map((k) => ({
              value: k,
              label: t.tabs[k] ?? k,
            }))}
          />
        )}
      </PageHeader>
      {overview.error ? (
        overview.error instanceof ApiFailure && overview.error.status === 403 ? (
          <StatePanel
            kind="denied"
            title={en.states.denied.title}
            body={t.errors.forbidden ?? ''}
          />
        ) : typeof navigator !== 'undefined' && !navigator.onLine ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={errorText(overview.error)} />
        )
      ) : !overview.data ? (
        <SkeletonRows rows={4} label={en.states.loading.title} />
      ) : !program ? (
        <Section>
          <EmptyState icon={Target} area="violet" title={t.noPrograms} body={t.noProgramsBody} />
        </Section>
      ) : tab === 'outcomes' ? (
        <Outcomes programId={program.id} manage={manage} />
      ) : tab === 'courses' ? (
        <Courses
          regulations={program.regulations.filter((r) => r.status === 'published')}
          manage={manage}
        />
      ) : (
        <Attainment
          batches={(overview.data.batches ?? []).filter((b) => b.programId === program.id)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Programme outcomes
// ---------------------------------------------------------------------------------------------

function Outcomes({ programId, manage }: { programId: string; manage: boolean }) {
  const qc = useQueryClient();
  const key = ['outcome-sets', programId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<OutcomeSet[]>(`/academics/programs/${programId}/outcome-sets`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const [form, setForm] = useState<'new' | 'edit' | null>(null);
  const publish = useMutation({
    mutationFn: (setId: string) => api.post(`/academics/outcome-sets/${setId}/publish`, {}),
    onSettled: refresh,
  });
  const sets = q.data ?? [];
  const draft = sets.find((s) => s.status === 'draft');
  const shown = draft ?? sets[0];
  return (
    <Section
      id="outcomes"
      title={t.outcomesTitle}
      description={t.outcomesLead}
      actions={
        manage ? (
          <span className="flex flex-wrap gap-2">
            {draft ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => setForm('edit')}>
                  {t.edit}
                </Button>
                <Button
                  size="sm"
                  disabled={publish.isPending}
                  onClick={() => publish.mutate(draft.id)}
                >
                  {t.publish}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setForm('new')}>
                <Plus aria-hidden className="size-4" />
                {sets.length ? t.newVersion : t.firstVersion}
              </Button>
            )}
          </span>
        ) : undefined
      }
    >
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !q.data ? (
        <SkeletonRows rows={3} label={en.states.loading.title} />
      ) : !shown ? (
        <EmptyState icon={Target} area="violet" title={t.noSets} body={t.noSetsBody} compact />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="flex flex-wrap items-center gap-2 text-body text-ink">
            <span className="font-medium">{t.version(shown.version)}</span>
            <Pill tone={shown.status === 'published' ? 'go' : 'warn'}>
              {t.statuses[shown.status]}
            </Pill>
            <span className="tabular text-caption text-ink-muted">
              {t.from(shown.effectiveFrom)}
            </span>
          </p>
          {(shown.vision || shown.mission) && (
            <dl className="grid gap-2 text-body sm:grid-cols-2">
              {shown.vision && (
                <div>
                  <dt className="text-caption font-medium text-ink-muted">{t.vision}</dt>
                  <dd className="text-ink">{shown.vision}</dd>
                </div>
              )}
              {shown.mission && (
                <div>
                  <dt className="text-caption font-medium text-ink-muted">{t.mission}</dt>
                  <dd className="text-ink">{shown.mission}</dd>
                </div>
              )}
            </dl>
          )}
          {KINDS.map((k) => {
            const list = shown.outcomes.filter((o) => o.kind === k);
            return list.length ? (
              <section key={k} aria-label={t.kinds[k]} className="flex flex-col gap-1">
                <h3 className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
                  {t.kinds[k]}
                </h3>
                <ul className="flex flex-col gap-1">
                  {list.map((o) => (
                    <li key={o.id} className="text-body text-ink">
                      <span className="tabular font-medium">{o.code}</span> · {o.statement}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null;
          })}
          <p className="text-caption text-ink-muted">
            {t.settingsLine(
              shown.targetPercent,
              shown.level1Percent,
              shown.level2Percent,
              shown.level3Percent,
              shown.cieWeight,
              shown.targetLevel,
            )}
          </p>
        </div>
      )}
      {publish.error && (
        <p role="alert" className="pt-3 text-caption text-signal-stop-ink">
          {errorText(publish.error)}
        </p>
      )}
      {form === 'new' && (
        <NewVersionForm
          programId={programId}
          onClose={() => setForm(null)}
          onDone={async () => (setForm(null), await refresh())}
        />
      )}
      {form === 'edit' && draft && (
        <SetForm
          set={draft}
          onClose={() => setForm(null)}
          onDone={async () => (setForm(null), await refresh())}
        />
      )}
    </Section>
  );
}

function NewVersionForm({
  programId,
  onClose,
  onDone,
}: {
  programId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [effectiveFrom, setDate] = useState(istToday());
  const m = useMutation({
    mutationFn: () => api.post(`/academics/programs/${programId}/outcome-sets`, { effectiveFrom }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.newVersion}
      description={t.newVersionLead}
      submitLabel={t.newVersion}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!effectiveFrom}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={t.effectiveFrom}>
        <input
          type="date"
          required
          value={effectiveFrom}
          onChange={(e) => setDate(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

function SetForm({
  set,
  onClose,
  onDone,
}: {
  set: OutcomeSet;
  onClose: () => void;
  onDone: () => void;
}) {
  const [v, setV] = useState({
    vision: set.vision ?? '',
    mission: set.mission ?? '',
    targetPercent: set.targetPercent,
    level1Percent: set.level1Percent,
    level2Percent: set.level2Percent,
    level3Percent: set.level3Percent,
    cieWeight: set.cieWeight,
    targetLevel: set.targetLevel,
  });
  const [rows, setRows] = useState(
    set.outcomes.map(({ kind, code, statement }) => ({ kind, code, statement })),
  );
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/outcome-sets/${set.id}`, {
        ...v,
        vision: v.vision.trim() || null,
        mission: v.mission.trim() || null,
        outcomes: rows,
      }),
    onSuccess: onDone,
  });
  const nextCode = (k: (typeof KINDS)[number]) =>
    `${k.toUpperCase()}${rows.filter((r) => r.kind === k).length + 1}`;
  const num = (key: keyof typeof v, label: string, max: number, step = 1) => (
    <ModalField label={label}>
      <input
        type="number"
        min={0}
        max={max}
        step={step}
        value={v[key] as number}
        onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
        className={`${fieldInput} tabular`}
      />
    </ModalField>
  );
  const ok =
    rows.every((r) => /^[A-Z]{2,4}[0-9]{1,2}$/.test(r.code) && r.statement.trim().length >= 3) &&
    new Set(rows.map((r) => r.code)).size === rows.length &&
    v.level1Percent < v.level2Percent &&
    v.level2Percent < v.level3Percent;
  return (
    <FormModal
      title={t.editTitle(set.version)}
      size="xl"
      submitLabel={t.save}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!ok}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={t.vision} wide>
        <textarea
          rows={2}
          value={v.vision}
          onChange={(e) => setV({ ...v, vision: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={t.mission} wide>
        <textarea
          rows={2}
          value={v.mission}
          onChange={(e) => setV({ ...v, mission: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      {num('targetPercent', t.targetPercent, 100)}
      {num('targetLevel', t.targetLevel, 3, 0.1)}
      {num('level1Percent', t.levelPercent(1), 100)}
      {num('level2Percent', t.levelPercent(2), 100)}
      {num('level3Percent', t.levelPercent(3), 100)}
      {num('cieWeight', t.cieWeight, 100)}
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="text-caption font-medium text-ink">{t.outcomesTitle}</legend>
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[5rem_1fr_auto] items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-muted">{t.codeOf(i + 1)}</span>
              <input
                value={r.code}
                onChange={(e) =>
                  setRows(
                    rows.map((x, j) =>
                      j === i ? { ...x, code: e.target.value.toUpperCase() } : x,
                    ),
                  )
                }
                className={`${fieldInput} tabular`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-muted">
                {t.statementOf(r.code || String(i + 1))}
              </span>
              <input
                value={r.statement}
                onChange={(e) =>
                  setRows(rows.map((x, j) => (j === i ? { ...x, statement: e.target.value } : x)))
                }
                className={fieldInput}
              />
            </label>
            <Button
              size="sm"
              variant="quiet"
              aria-label={t.removeOutcome(r.code || String(i + 1))}
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
        <span className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <Button
              key={k}
              size="sm"
              variant="secondary"
              onClick={() => setRows([...rows, { kind: k, code: nextCode(k), statement: '' }])}
            >
              <Plus aria-hidden className="size-4" />
              {t.add[k]}
            </Button>
          ))}
        </span>
      </fieldset>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Course outcomes and the matrix
// ---------------------------------------------------------------------------------------------

function Courses({
  regulations,
  manage,
}: {
  regulations: { id: string; code: string; version: number }[];
  manage: boolean;
}) {
  const [regId, setReg] = useState(regulations[0]?.id ?? '');
  const reg = useQuery({
    queryKey: ['regulation', regId],
    queryFn: () => api.get<RegulationView>(`/academics/regulations/${regId}`),
    enabled: !!regId,
  });
  const [courseId, setCourse] = useState<string | null>(null);
  const course = reg.data?.courses.find((c) => c.courseId === courseId) ?? reg.data?.courses[0];
  const qc = useQueryClient();
  const key = ['course-outcomes', regId, course?.courseId];
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<CourseOutcomesView>(
        `/academics/regulations/${regId}/courses/${course?.courseId}/outcomes`,
      ),
    enabled: !!course,
  });
  const [editing, setEditing] = useState(false);
  const v = q.data;
  const mapped = v?.set?.outcomes.filter((o) => o.kind !== 'peo') ?? [];
  const itemName = (item: string): string =>
    (item === 'see'
      ? t.items.see
      : item === 'cie'
        ? t.items.cie
        : v?.components?.[Number(item.slice(4))]?.name) ?? item;
  if (!regulations.length)
    return (
      <Section>
        <EmptyState icon={Target} area="violet" title={t.noRegulations} compact />
      </Section>
    );
  return (
    <Section
      id="courses"
      title={t.coursesTitle}
      description={t.coursesLead}
      actions={
        manage && v?.set ? (
          <Button size="sm" onClick={() => setEditing(true)}>
            {t.editCos}
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-wrap items-end gap-3 pb-4">
        <label className="flex flex-col gap-1">
          <span className="text-caption font-medium text-ink">{t.regulation}</span>
          <select
            value={regId}
            onChange={(e) => (setReg(e.target.value), setCourse(null))}
            className={fieldInput}
          >
            {regulations.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} v{r.version}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-64 flex-col gap-1">
          <span className="text-caption font-medium text-ink">{t.course}</span>
          <select
            value={course?.courseId ?? ''}
            onChange={(e) => setCourse(e.target.value)}
            className={fieldInput}
          >
            {(reg.data?.courses ?? []).map((c) => (
              <option key={c.courseId} value={c.courseId}>
                {c.code} · {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !v ? (
        <SkeletonRows rows={3} label={en.states.loading.title} />
      ) : !v.set ? (
        <EmptyState icon={Target} area="violet" title={t.noSets} body={t.noSetsBody} compact />
      ) : v.cos.length === 0 ? (
        <p className="text-body text-ink-muted">{t.noCos}</p>
      ) : (
        // Focusable so keyboard users can scroll it on a phone.
        <div className="overflow-x-auto" tabIndex={0}>
          <table className="w-full min-w-[640px] text-body">
            <caption className="sr-only">{t.matrix(v.course.code)}</caption>
            <thead>
              <tr className="border-y border-line bg-paper text-left text-caption tracking-wide text-ink-muted uppercase">
                <th scope="col" className="px-3 py-2 font-medium">
                  {t.co}
                </th>
                {mapped.map((o) => (
                  <th
                    key={o.id}
                    scope="col"
                    className="px-2 py-2 text-center font-medium"
                    title={o.statement}
                  >
                    {o.code}
                  </th>
                ))}
                <th scope="col" className="px-3 py-2 font-medium">
                  {t.measuredBy}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {v.cos.map((co) => (
                <tr key={co.id}>
                  <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                    <span className="tabular font-medium">{co.code}</span>
                    <span className="block text-caption text-ink-muted">{co.statement}</span>
                  </th>
                  {mapped.map((o) => (
                    <td key={o.id} className="tabular px-2 py-2 text-center text-ink">
                      {co.mappings[o.id] ?? '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-caption text-ink">
                    {co.items.length ? (
                      co.items.map(itemName).join(', ')
                    ) : (
                      <span className="text-signal-warn-ink">{t.notMeasured}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && v?.set && (
        <CosForm
          view={v}
          regulationId={regId}
          onClose={() => setEditing(false)}
          onDone={async () => (setEditing(false), await qc.invalidateQueries({ queryKey: key }))}
        />
      )}
    </Section>
  );
}

function CosForm({
  view,
  regulationId,
  onClose,
  onDone,
}: {
  view: CourseOutcomesView;
  regulationId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const outcomes = view.set?.outcomes.filter((o) => o.kind !== 'peo') ?? [];
  const items = ['see', ...(view.components ? view.components.map((_, i) => `cie:${i}`) : ['cie'])];
  const itemName = (item: string): string =>
    (item === 'see'
      ? t.items.see
      : item === 'cie'
        ? t.items.cie
        : view.components?.[Number(item.slice(4))]?.name) ?? item;
  const [rows, setRows] = useState(
    view.cos.map((c) => ({
      code: c.code,
      statement: c.statement,
      mappings: Object.fromEntries(
        Object.entries(c.mappings).flatMap(([id, l]) => {
          const o = outcomes.find((x) => x.id === id);
          return o ? [[o.code, l]] : [];
        }),
      ) as Record<string, number>,
      items: c.items,
    })),
  );
  const set = (i: number, change: Partial<(typeof rows)[number]>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)));
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/regulations/${regulationId}/courses/${view.course.courseId}/outcomes`, {
        cos: rows,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.cosTitle(view.course.code)}
      description={t.cosLead}
      size="xl"
      submitLabel={t.save}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={rows.some((r) => r.statement.trim().length < 3)}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <div className="flex flex-col gap-4 sm:col-span-2">
        {rows.map((r, i) => (
          <fieldset key={i} className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <legend className="tabular px-1 text-caption font-semibold text-ink">{r.code}</legend>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-muted">{t.statementOf(r.code)}</span>
              <input
                value={r.statement}
                onChange={(e) => set(i, { statement: e.target.value })}
                className={fieldInput}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {outcomes.map((o) => (
                <label key={o.id} className="flex flex-col gap-1">
                  <span className="tabular text-caption text-ink-muted">
                    {t.mapLevel(r.code, o.code)}
                  </span>
                  <select
                    value={r.mappings[o.code] ?? 0}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      const next = Object.fromEntries(
                        Object.entries(r.mappings).filter(([code]) => code !== o.code),
                      );
                      set(i, { mappings: n ? { ...next, [o.code]: n } : next });
                    }}
                    className={`${fieldInput} w-24`}
                  >
                    <option value={0}>—</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              {items.map((item) => (
                <label key={item} className="flex items-center gap-2 text-caption text-ink">
                  <input
                    type="checkbox"
                    checked={r.items.includes(item)}
                    onChange={(e) =>
                      set(i, {
                        items: e.target.checked
                          ? [...r.items, item]
                          : r.items.filter((x) => x !== item),
                      })
                    }
                    className="size-4 accent-navy-950"
                  />
                  {t.measures(r.code, itemName(item))}
                </label>
              ))}
            </div>
            <Button
              size="sm"
              variant="quiet"
              className="self-start"
              onClick={() => setRows(rows.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden className="size-4" />
              {t.removeCo(r.code)}
            </Button>
          </fieldset>
        ))}
        {rows.length < 12 && (
          <Button
            size="sm"
            variant="secondary"
            className="self-start"
            onClick={() =>
              setRows([
                ...rows,
                { code: `CO${rows.length + 1}`, statement: '', mappings: {}, items: [] },
              ])
            }
          >
            <Plus aria-hidden className="size-4" />
            {t.addCo}
          </Button>
        )}
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Attainment
// ---------------------------------------------------------------------------------------------

function Attainment({ batches }: { batches: StructureOverview['batches'] }) {
  const [batchId, setBatch] = useState(batches[0]?.id ?? '');
  const batch = batches.find((b) => b.id === batchId);
  const [term, setTerm] = useState(1);
  const q = useQuery({
    queryKey: ['attainment', batchId, term],
    queryFn: () => api.get<AttainmentView>(`/academics/batches/${batchId}/attainment?term=${term}`),
    enabled: !!batchId,
    retry: false,
  });
  const a = q.data;
  if (!batches.length)
    return (
      <Section>
        <EmptyState icon={Target} area="violet" title={t.noBatches} compact />
      </Section>
    );
  return (
    <>
      <Section id="attainment" title={t.attainmentTitle} description={t.attainmentLead}>
        <div className="flex flex-wrap items-end gap-3 pb-4">
          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium text-ink">{t.batch}</span>
            <select
              value={batchId}
              onChange={(e) => (setBatch(e.target.value), setTerm(1))}
              className={fieldInput}
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.programCode} {b.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-caption font-medium text-ink">{t.term}</span>
            <select
              value={term}
              onChange={(e) => setTerm(Number(e.target.value))}
              className={fieldInput}
            >
              {Array.from({ length: batch?.currentTerm ?? 1 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {en.academics.termKinds[batch?.termKind ?? 'semester']} {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        {q.error ? (
          <p role="alert" className="text-body text-ink-muted">
            {errorText(q.error)}
          </p>
        ) : !a ? (
          <SkeletonRows rows={3} label={en.states.loading.title} />
        ) : (
          <>
            <p className="pb-3 text-caption text-ink-muted">
              {t.settingsLine(
                a.settings.targetPercent,
                a.settings.level1Percent,
                a.settings.level2Percent,
                a.settings.level3Percent,
                a.settings.cieWeight,
                a.settings.targetLevel,
              )}
            </p>
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full min-w-[720px] text-body">
                <caption className="sr-only">{t.coAttainment}</caption>
                <thead>
                  <tr className="border-y border-line bg-paper text-left text-caption tracking-wide text-ink-muted uppercase">
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t.co}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t.items.cie}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t.items.see}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t.levelCol}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {a.courses.flatMap((c) =>
                    c.cos.length === 0
                      ? [
                          <tr key={c.courseId}>
                            <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                              {c.code} · {c.title}
                            </th>
                            <td colSpan={3} className="px-3 py-2 text-caption text-signal-warn-ink">
                              {t.noCos}
                            </td>
                          </tr>,
                        ]
                      : c.cos.map((co) => (
                          <tr key={co.id}>
                            <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                              <span className="tabular font-medium">
                                {c.code} {co.code}
                              </span>
                              <span className="block text-caption text-ink-muted">
                                {co.statement}
                              </span>
                            </th>
                            <td className="tabular px-3 py-2 text-ink">
                              {co.cie ? t.side(co.cie.achieved, co.cie.of, co.cie.level) : '—'}
                            </td>
                            <td className="tabular px-3 py-2 text-ink">
                              {co.see ? t.side(co.see.achieved, co.see.of, co.see.level) : '—'}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span className="tabular mr-2 text-ink">{level(co.level)}</span>
                              {co.met !== null && (
                                <Pill tone={co.met ? 'go' : 'stop'}>
                                  {co.met ? t.met : t.notMet}
                                </Pill>
                              )}
                            </td>
                          </tr>
                        )),
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
      {a && (
        <Section id="po-attainment" title={t.poTitle} description={t.poLead}>
          <ul className="divide-y divide-line">
            {a.outcomes.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1 text-body text-ink">
                  <span className="tabular font-medium">{o.code}</span> · {o.statement}
                  <span className="block text-caption text-ink-muted">{t.fromCos(o.cos)}</span>
                </span>
                <span className="tabular text-body font-semibold text-ink">{level(o.value)}</span>
                {o.met !== null && (
                  <Pill tone={o.met ? 'go' : 'stop'}>{o.met ? t.met : t.notMet}</Pill>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}
