'use client';

// Academics › Academic Structure (rule book §13.2, §12.4 decisions 2–3): programs with versioned
// regulations and their curricula, and batches that keep their regulation and move on one term
// at a time. Colleges and universities; schools keep classes in Setup.
import type {
  BatchRow,
  BatchView,
  CurriculumCourse,
  ProgramRow,
  RegulationView,
  StructureOverview,
} from '@campusverse/academics-structure';
import type { EnrolFromFile } from '@campusverse/academics-structure';
import {
  Button,
  EmptyState,
  FormModal,
  IconTile,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  RecordDrawer,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BookOpen,
  Download,
  CalendarRange,
  CheckCircle2,
  GraduationCap,
  Layers,
  Library,
  Plus,
  ScrollText,
  Trash2,
  TriangleAlert,
  Upload,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';

const t = en.academics;
const dash = '—';
const date = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(`${d.slice(0, 10)}T00:00:00`),
  );
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
const termName = (kind: string, n: number) => `${t.termKinds[kind] ?? kind} ${n}`;
const regName = (r: { code: string; version: number }) => `${r.code} v${r.version}`;
const LEVELS = ['ug', 'pg', 'diploma', 'certificate', 'doctoral'] as const;
const TERM_KINDS = ['semester', 'trimester', 'year'] as const;
const KINDS = ['core', 'elective', 'open_elective', 'lab', 'project', 'value_added'] as const;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

type Open = { kind: 'regulation'; id: string } | { kind: 'batch'; id: string } | null;

export function StructureView() {
  const school = useInstitution();
  const id = school.institutionId;
  const [open, setOpen] = useState<Open>(null);
  const [form, setForm] = useState<
    | { kind: 'program' }
    | { kind: 'regulation'; program: ProgramRow; code?: string }
    | { kind: 'batch'; programId?: string }
    | null
  >(null);
  const q = useQuery({
    queryKey: ['academics', id],
    queryFn: () => api.get<StructureOverview>(`/academics/structure?institutionId=${id}`),
    enabled: !!id,
  });
  const d = q.data;
  const denied = q.error instanceof ApiFailure && q.error.status === 403;
  const isSchool = d?.profile === 'school';
  const published = d?.programs.flatMap((p) =>
    p.regulations.filter((r) => r.status === 'published'),
  );
  const running = d?.batches.filter((b) => b.status === 'running');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Library}
        area="violet"
        eyebrow={en.systems.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          d && !isSchool ? (
            <>
              {d.programs.length > 0 && (
                <Button variant="secondary" onClick={() => setForm({ kind: 'batch' })}>
                  <Layers aria-hidden />
                  {t.addBatch}
                </Button>
              )}
              <Button onClick={() => setForm({ kind: 'program' })}>
                <Plus aria-hidden />
                {t.addProgram}
              </Button>
            </>
          ) : undefined
        }
      />
      {denied ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={t.errors.forbidden ?? ''} />
      ) : q.error ? (
        typeof navigator !== 'undefined' && !navigator.onLine ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={t.errors.error ?? ''} />
        )
      ) : isSchool ? (
        <Section>
          <EmptyState
            icon={GraduationCap}
            area="violet"
            title={t.schoolTitle}
            body={t.schoolBody}
            actions={
              <Link
                href="/setup"
                className="inline-flex h-10 items-center rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-950/90"
              >
                {t.openSetup}
              </Link>
            }
          />
        </Section>
      ) : (
        <>
          <KeyFigures
            label={t.figures}
            loading={!d}
            figures={[
              {
                label: t.fig.programs,
                icon: GraduationCap,
                value: String(d?.programs.length ?? '–'),
              },
              { label: t.fig.published, icon: ScrollText, value: String(published?.length ?? '–') },
              { label: t.fig.batches, icon: Layers, value: String(running?.length ?? '–') },
              {
                label: t.fig.students,
                icon: Users,
                value: running
                  ? running.reduce((n, b) => n + b.students, 0).toLocaleString('en-IN')
                  : '–',
              },
            ]}
          />
          {!d ? (
            <SkeletonRows rows={6} label={en.states.loading.title} />
          ) : d.programs.length === 0 ? (
            <Section>
              <EmptyState
                art="setup"
                title={t.emptyTitle}
                body={t.emptyBody}
                tips={t.emptyTips}
                actions={
                  <Button onClick={() => setForm({ kind: 'program' })}>
                    <Plus aria-hidden />
                    {t.addProgram}
                  </Button>
                }
              />
            </Section>
          ) : (
            <>
              <Section id="batches" title={t.batches} description={t.batchesLead} flush>
                {d.batches.length === 0 ? (
                  <p className="px-6 py-5 text-body text-ink-muted">{t.noBatches}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <BatchTable
                      rows={d.batches}
                      onOpen={(b) => setOpen({ kind: 'batch', id: b })}
                    />
                  </div>
                )}
              </Section>
              <Section id="programs" title={t.programs} description={t.programsLead} flush>
                <ul className="divide-y divide-line">
                  {d.programs.map((p) => (
                    <ProgramItem
                      key={p.id}
                      program={p}
                      onOpen={(r) => setOpen({ kind: 'regulation', id: r })}
                      onDraft={(code) =>
                        setForm({ kind: 'regulation', program: p, ...(code ? { code } : {}) })
                      }
                    />
                  ))}
                </ul>
              </Section>
            </>
          )}
        </>
      )}
      {form?.kind === 'program' && id && (
        <ProgramForm institutionId={id} onClose={() => setForm(null)} />
      )}
      {form?.kind === 'regulation' && (
        <RegulationForm
          program={form.program}
          {...(form.code ? { code: form.code } : {})}
          onClose={() => setForm(null)}
          onDone={(rid) => (setForm(null), setOpen({ kind: 'regulation', id: rid }))}
        />
      )}
      {form?.kind === 'batch' && d && (
        <BatchForm
          programs={d.programs}
          onClose={() => setForm(null)}
          onDone={(bid) => (setForm(null), setOpen({ kind: 'batch', id: bid }))}
        />
      )}
      <RegulationDrawer
        id={open?.kind === 'regulation' ? open.id : null}
        onClose={() => setOpen(null)}
      />
      <BatchDrawer id={open?.kind === 'batch' ? open.id : null} onClose={() => setOpen(null)} />
    </div>
  );
}

function BatchTable({ rows, onOpen }: { rows: BatchRow[]; onOpen: (id: string) => void }) {
  const c = t.table;
  return (
    <table className="w-full min-w-[860px] text-body">
      <caption className="sr-only">{t.batches}</caption>
      <thead>
        <tr className="border-b border-line bg-paper text-left text-caption tracking-wide whitespace-nowrap text-ink-muted uppercase">
          {[c.batch, c.regulation, c.term, c.dates, c.sections, c.students].map((h) => (
            <th key={h} scope="col" className="px-5 py-2 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((b) => {
          const kind = t.termKinds[b.termKind] ?? b.termKind;
          const name = `${b.programCode} ${b.label}`;
          return (
            <tr key={b.id}>
              <th scope="row" className="px-5 py-3 text-left font-normal">
                <button
                  type="button"
                  onClick={() => onOpen(b.id)}
                  aria-label={t.openBatch(name)}
                  className="text-left font-medium text-navy-950 underline-offset-2 hover:underline"
                >
                  {name}
                </button>
                <span className="block text-caption text-ink-muted">{b.programName}</span>
              </th>
              <td className="px-5 py-3 whitespace-nowrap text-ink">{b.regulation}</td>
              <td className="px-5 py-3">
                {b.status === 'completed' ? (
                  <Pill>{t.statuses.completed}</Pill>
                ) : (
                  <span className="flex flex-wrap items-center gap-2 whitespace-nowrap">
                    <span className="text-ink">{t.termOf(kind, b.currentTerm, b.terms)}</span>
                    <Pill tone="neutral">{t.parity[b.parity]}</Pill>
                  </span>
                )}
              </td>
              <td className="tabular px-5 py-3 whitespace-nowrap text-ink">
                {b.startsOn && b.endsOn && b.status === 'running'
                  ? `${date(b.startsOn)} – ${date(b.endsOn)}`
                  : dash}
              </td>
              <td className="tabular px-5 py-3 text-ink">{b.sections}</td>
              <td className="tabular px-5 py-3 text-ink">
                {b.students}
                {b.intake ? <span className="text-ink-muted"> / {b.intake}</span> : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ProgramItem({
  program: p,
  onOpen,
  onDraft,
}: {
  program: ProgramRow;
  onOpen: (regulationId: string) => void;
  onDraft: (code?: string) => void;
}) {
  const hasDraft = (code: string) =>
    p.regulations.some((r) => r.code === code && r.status === 'draft');
  return (
    <li className="flex flex-col gap-3 px-6 py-5" aria-label={`${p.code} ${p.name}`}>
      <div className="flex flex-wrap items-start gap-3">
        <IconTile icon={BookOpen} area="violet" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">
            {p.name} <span className="font-normal text-ink-muted">· {p.code}</span>
          </p>
          <p className="text-caption text-ink-muted">
            {t.programMeta(
              t.levels[p.level] ?? p.level,
              p.terms,
              t.termKindsPlural[p.termKind] ?? '',
            )}
            {' · '}
            {p.framework ? (t.frameworks[p.framework] ?? p.framework) : t.noFramework}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onDraft()}>
          <Plus aria-hidden />
          {t.draftRegulation}
        </Button>
      </div>
      {p.regulations.length === 0 ? (
        <p className="pl-13 text-caption text-ink-muted">{t.noRegulations}</p>
      ) : (
        <ul className="flex flex-col gap-2 sm:pl-13">
          {p.regulations.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper/60 px-4 py-2.5"
            >
              <button
                type="button"
                onClick={() => onOpen(r.id)}
                aria-label={t.openRegulation(`${p.code} ${regName(r)}`)}
                className="font-medium text-navy-950 underline-offset-2 hover:underline"
              >
                {regName(r)}
              </button>
              <Pill tone={r.status === 'published' ? 'go' : 'warn'}>{t.statuses[r.status]}</Pill>
              <span className="text-caption text-ink-muted">
                {t.effective(date(r.effectiveFrom))} ·{' '}
                {t.regulationMeta(r.courses, r.credits, r.batches)}
              </span>
              <span className="flex-1" />
              {/* The latest version of each code (versions come newest first). */}
              {r.status === 'published' &&
                !hasDraft(r.code) &&
                p.regulations.find((x) => x.code === r.code) === r && (
                  <Button variant="quiet" size="sm" onClick={() => onDraft(r.code)}>
                    {t.newVersion}
                  </Button>
                )}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------

function useSaved(keys: unknown[][]) {
  const qc = useQueryClient();
  return () => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: k })));
}

function ProgramForm({ institutionId, onClose }: { institutionId: string; onClose: () => void }) {
  const f = t.programForm;
  const [v, setV] = useState({
    code: '',
    name: '',
    level: 'ug' as (typeof LEVELS)[number],
    termKind: 'semester' as (typeof TERM_KINDS)[number],
    terms: 8,
    framework: 'UGC_UG4',
  });
  const saved = useSaved([['academics']]);
  const m = useMutation({
    mutationFn: () =>
      api.post('/academics/programs', {
        institutionId,
        ...v,
        framework: v.framework || null,
      }),
    onSuccess: async () => (await saved(), onClose()),
  });
  return (
    <FormModal
      title={t.addProgram}
      submitLabel={t.addProgram}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(v.code) || v.name.trim().length < 2}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={f.name} wide>
        <input
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.code} hint={f.codeHint}>
        <input
          required
          value={v.code}
          onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.level}>
        <select
          value={v.level}
          onChange={(e) => setV({ ...v, level: e.target.value as (typeof LEVELS)[number] })}
          className={fieldInput}
        >
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {t.levels[l]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.termKind}>
        <select
          value={v.termKind}
          onChange={(e) => setV({ ...v, termKind: e.target.value as (typeof TERM_KINDS)[number] })}
          className={fieldInput}
        >
          {TERM_KINDS.map((k) => (
            <option key={k} value={k}>
              {t.termKinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.terms}>
        <input
          type="number"
          min={1}
          max={16}
          value={v.terms}
          onChange={(e) => setV({ ...v, terms: Number(e.target.value) })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.framework} wide>
        <select
          value={v.framework}
          onChange={(e) => setV({ ...v, framework: e.target.value })}
          className={fieldInput}
        >
          <option value="">{t.noFramework}</option>
          {Object.entries(t.frameworks).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </ModalField>
    </FormModal>
  );
}

function RegulationForm({
  program,
  code: given,
  onClose,
  onDone,
}: {
  program: ProgramRow;
  code?: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const f = t.regulationForm;
  const [v, setV] = useState({ code: given ?? '', effectiveFrom: '', minCredits: '' });
  const saved = useSaved([['academics']]);
  const m = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/academics/programs/${program.id}/regulations`, {
        code: v.code,
        effectiveFrom: v.effectiveFrom,
        minCredits: v.minCredits ? Number(v.minCredits) : null,
      }),
    onSuccess: async (r) => (await saved(), onDone(r.id)),
  });
  return (
    <FormModal
      title={given ? t.newVersion : t.draftRegulation}
      description={`${program.name} · ${program.code}`}
      submitLabel={given ? t.newVersion : t.draftRegulation}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(v.code) || !v.effectiveFrom}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={f.code} hint={f.codeHint} wide>
        <input
          required
          readOnly={!!given}
          value={v.code}
          onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.effectiveFrom}>
        <input
          type="date"
          required
          value={v.effectiveFrom}
          onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.minCredits} hint={f.minHint}>
        <input
          type="number"
          min={1}
          step="0.5"
          inputMode="decimal"
          value={v.minCredits}
          onChange={(e) => setV({ ...v, minCredits: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

function BatchForm({
  programs,
  onClose,
  onDone,
}: {
  programs: ProgramRow[];
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const f = t.batchForm;
  const year = new Date().getFullYear();
  const [programId, setProgramId] = useState(programs[0]?.id ?? '');
  const program = programs.find((p) => p.id === programId);
  const regs = program?.regulations.filter((r) => r.status === 'published') ?? [];
  const [regulationId, setRegulationId] = useState('');
  const reg = regs.find((r) => r.id === regulationId) ?? regs[0];
  const [v, setV] = useState({
    startYear: year,
    label: '',
    intake: '',
    sections: 2,
    capacity: 60,
    startsOn: '',
    endsOn: '',
  });
  const perYear = program?.termKind === 'semester' ? 2 : program?.termKind === 'trimester' ? 3 : 1;
  const auto = program
    ? `${v.startYear}–${String(v.startYear + Math.ceil(program.terms / perYear)).slice(-2)}`
    : '';
  const saved = useSaved([['academics']]);
  const m = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/academics/programs/${programId}/batches`, {
        regulationId: reg?.id,
        startYear: v.startYear,
        label: v.label.trim() || null,
        intake: v.intake ? Number(v.intake) : null,
        sections: LETTERS.slice(0, v.sections).split(''),
        capacity: v.capacity,
        startsOn: v.startsOn,
        endsOn: v.endsOn,
      }),
    onSuccess: async (r) => (await saved(), onDone(r.id)),
  });
  return (
    <FormModal
      title={t.addBatch}
      size="lg"
      submitLabel={t.addBatch}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!reg || !v.startsOn || !v.endsOn || v.endsOn <= v.startsOn}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={f.program}>
        <select
          value={programId}
          onChange={(e) => (setProgramId(e.target.value), setRegulationId(''))}
          className={fieldInput}
        >
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.regulation} {...(regs.length === 0 ? { hint: f.noPublished } : {})}>
        <select
          value={reg?.id ?? ''}
          disabled={regs.length === 0}
          onChange={(e) => setRegulationId(e.target.value)}
          className={fieldInput}
        >
          {regs.map((r) => (
            <option key={r.id} value={r.id}>
              {regName(r)}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.startYear}>
        <input
          type="number"
          min={2000}
          max={2100}
          value={v.startYear}
          onChange={(e) => setV({ ...v, startYear: Number(e.target.value) })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.label} hint={f.labelHint(auto)}>
        <input
          value={v.label}
          onChange={(e) => setV({ ...v, label: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.sections}>
        <input
          type="number"
          min={1}
          max={26}
          value={v.sections}
          onChange={(e) => setV({ ...v, sections: Number(e.target.value) })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.capacity}>
        <input
          type="number"
          min={1}
          max={500}
          value={v.capacity}
          onChange={(e) => setV({ ...v, capacity: Number(e.target.value) })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.intake}>
        <input
          type="number"
          min={1}
          value={v.intake}
          onChange={(e) => setV({ ...v, intake: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <span aria-hidden className="hidden sm:block" />
      <ModalField label={f.startsOn}>
        <input
          type="date"
          required
          value={v.startsOn}
          onChange={(e) => setV({ ...v, startsOn: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.endsOn}>
        <input
          type="date"
          required
          value={v.endsOn}
          onChange={(e) => setV({ ...v, endsOn: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Regulation
// ---------------------------------------------------------------------------------------------

function RegulationDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [course, setCourse] = useState<CurriculumCourse | 'new' | null>(null);
  const [publishing, setPublishing] = useState(false);
  const q = useQuery({
    queryKey: ['regulation', id],
    queryFn: () => api.get<RegulationView>(`/academics/regulations/${id}`),
    enabled: !!id,
  });
  const saved = useSaved([['regulation', id], ['academics']]);
  const remove = useMutation({
    mutationFn: (courseId: string) =>
      api.delete(`/academics/regulations/${id}/courses/${courseId}`),
    onSuccess: saved,
  });
  const r = q.data;
  const draft = r?.status === 'draft';
  return (
    <RecordDrawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={r ? `${r.programCode} ${regName(r)}` : t.curriculum}
      {...(r ? { subtitle: `${r.programName} · ${t.statuses[r.status]}` } : {})}
      closeLabel={en.form.close}
    >
      {!r ? (
        q.error ? (
          <StatePanel kind="error" title={errorText(q.error)} />
        ) : (
          <SkeletonRows rows={5} label={en.states.loading.title} />
        )
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <p className="text-caption text-ink-muted">{t.totalCredits}</p>
              <p className="tabular font-display text-title font-bold text-ink">
                {r.check.totalCredits}
              </p>
            </div>
            <p className="pb-1 text-caption text-ink-muted">
              {r.minCredits
                ? t.needed(r.minCredits)
                : r.framework
                  ? `${t.needed(r.framework.totalCredits)} · ${r.framework.title}`
                  : t.noFramework}
            </p>
          </div>
          <p className="text-caption text-ink-muted">
            {r.publishedAt ? t.published(date(r.publishedAt)) : t.effective(date(r.effectiveFrom))}
          </p>
          <Checks regulation={r} />
          {draft && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => setCourse('new')}>
                <Plus aria-hidden />
                {t.addCourse}
              </Button>
              <Button
                size="sm"
                onClick={() => setPublishing(true)}
                disabled={r.check.blocking.length > 0}
              >
                <CheckCircle2 aria-hidden />
                {t.publish}
              </Button>
            </div>
          )}
          <section aria-label={t.curriculum} className="flex flex-col gap-4">
            {Array.from({ length: r.terms }, (_, i) => i + 1).map((term) => {
              const rows = r.courses.filter((c) => c.termNumber === term);
              const name = termName(r.termKind, term);
              return (
                <div key={term} className="flex flex-col gap-1.5">
                  <h3 className="flex items-center justify-between text-caption font-semibold tracking-wide text-ink-muted uppercase">
                    <span>{name}</span>
                    <span className="tabular">{t.credits(r.check.termCredits[term - 1] ?? 0)}</span>
                  </h3>
                  {rows.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-line px-3 py-2 text-caption text-ink-muted">
                      {t.noCourses}
                    </p>
                  ) : (
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {rows.map((c) => (
                        <li key={c.courseId} className="flex items-start gap-3 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            {draft ? (
                              <button
                                type="button"
                                onClick={() => setCourse(c)}
                                className="text-left text-body font-medium text-navy-950 underline-offset-2 hover:underline"
                              >
                                {c.code} · {c.title}
                              </button>
                            ) : (
                              <p className="text-body font-medium text-ink">
                                {c.code} · {c.title}
                              </p>
                            )}
                            <p className="text-caption text-ink-muted">
                              {t.kinds[c.kind]} · {t.ltp(c.lecture, c.tutorial, c.practical)}
                            </p>
                          </div>
                          <span className="tabular shrink-0 text-body text-ink">{c.credits}</span>
                          {draft && (
                            <button
                              type="button"
                              aria-label={t.removeCourse(c.code)}
                              onClick={() => remove.mutate(c.courseId)}
                              className="flex size-8 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-signal-stop-tint hover:text-signal-stop-ink"
                            >
                              <Trash2 aria-hidden className="size-4" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      )}
      {r && course && (
        <CourseForm
          regulation={r}
          course={course === 'new' ? null : course}
          onClose={() => setCourse(null)}
        />
      )}
      {r && publishing && <PublishForm regulation={r} onClose={() => setPublishing(false)} />}
    </RecordDrawer>
  );
}

function warningText(r: RegulationView, w: RegulationView['check']['warnings'][number]): string {
  const term = (n: number) => termName(r.termKind, n);
  switch (w.kind) {
    case 'term_empty':
      return t.warning.term_empty(term(w.term));
    case 'term_load':
      return t.warning.term_load(term(w.term), w.credits, w.min, w.max);
    case 'below_minimum':
      return t.warning.below_minimum(w.credits, w.minimum);
    case 'exit_short':
      return t.warning.exit_short(term(w.term), w.credits, w.needed, w.award);
  }
}

function Checks({ regulation: r }: { regulation: RegulationView }) {
  const items = [
    ...r.check.blocking.map((b) => ({ stop: true, text: t.blocking[b] ?? b })),
    ...r.check.warnings.map((w) => ({ stop: false, text: warningText(r, w) })),
  ];
  return (
    <section aria-label={t.checks} className="rounded-lg bg-paper px-4 py-3">
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-body text-ink">
          <CheckCircle2 aria-hidden className="size-4 shrink-0 text-signal-go" />
          {r.framework || r.minCredits ? t.allChecksPass : t.allTermsFilled}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((i) => (
            <li key={i.text} className="flex items-start gap-2 text-caption text-ink">
              <TriangleAlert
                aria-hidden
                className={`mt-0.5 size-4 shrink-0 ${i.stop ? 'text-signal-stop' : 'text-signal-warn'}`}
              />
              {i.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CourseForm({
  regulation: r,
  course,
  onClose,
}: {
  regulation: RegulationView;
  course: CurriculumCourse | null;
  onClose: () => void;
}) {
  const f = t.courseForm;
  const [v, setV] = useState({
    code: course?.code ?? '',
    title: course?.title ?? '',
    termNumber: course?.termNumber ?? 1,
    kind: (course?.kind ?? 'core') as (typeof KINDS)[number],
    lecture: course?.lecture ?? 3,
    tutorial: course?.tutorial ?? 0,
    practical: course?.practical ?? 0,
    credits: course?.credits ?? 3,
  });
  // Internal assessment components (rule book §13.2 "CIE Plan"); none means one internal mark.
  const [plan, setPlan] = useState<{ name: string; maxMarks: number; weight: number }[]>(
    course?.cieComponents ?? [],
  );
  const weights = plan.reduce((n, c) => n + c.weight, 0);
  const planOk =
    plan.length === 0 ||
    (Math.abs(weights - 100) < 1e-9 &&
      plan.every((c) => c.name.trim() && c.maxMarks > 0 && c.weight > 0));
  const setPart = (i: number, change: Partial<(typeof plan)[number]>) =>
    setPlan(plan.map((c, j) => (j === i ? { ...c, ...change } : c)));
  const ltp = v.lecture + v.tutorial + v.practical / 2;
  const saved = useSaved([['regulation', r.id], ['academics']]);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/regulations/${r.id}/courses`, {
        ...v,
        cieComponents: plan.length ? plan : null,
      }),
    onSuccess: async () => (await saved(), onClose()),
  });
  const num = (key: 'lecture' | 'tutorial' | 'practical' | 'credits', max: number, step = 1) => (
    <input
      type="number"
      min={0}
      max={max}
      step={step}
      value={v[key]}
      onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
      className={fieldInput}
    />
  );
  return (
    <FormModal
      title={course ? t.editCourse : t.addCourse}
      description={`${r.programCode} ${regName(r)}`}
      submitLabel={course ? t.editCourse : t.addCourse}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={
        !/^[A-Z0-9][A-Z0-9-]{1,19}$/.test(v.code) || v.title.trim().length < 2 || !planOk
      }
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={f.code}>
        <input
          required
          readOnly={!!course}
          value={v.code}
          onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.term}>
        <select
          value={v.termNumber}
          onChange={(e) => setV({ ...v, termNumber: Number(e.target.value) })}
          className={fieldInput}
        >
          {Array.from({ length: r.terms }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {termName(r.termKind, n)}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.title} wide>
        <input
          required
          value={v.title}
          onChange={(e) => setV({ ...v, title: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.kind}>
        <select
          value={v.kind}
          onChange={(e) => setV({ ...v, kind: e.target.value as (typeof KINDS)[number] })}
          className={fieldInput}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.lecture}>{num('lecture', 12)}</ModalField>
      <ModalField label={f.tutorial}>{num('tutorial', 12)}</ModalField>
      <ModalField label={f.practical}>{num('practical', 24)}</ModalField>
      <ModalField label={f.credits} hint={f.creditsHint(ltp)}>
        {num('credits', 30, 0.5)}
      </ModalField>
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="text-caption font-medium text-ink">{f.cie}</legend>
        <p className="text-caption text-ink-muted">{f.cieHint}</p>
        {plan.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem_6rem_auto] items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-muted">{f.cieName(i + 1)}</span>
              <input
                value={c.name}
                maxLength={40}
                onChange={(e) => setPart(i, { name: e.target.value })}
                className={fieldInput}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-muted">{f.cieMax(i + 1)}</span>
              <input
                type="number"
                min={1}
                max={200}
                value={c.maxMarks}
                onChange={(e) => setPart(i, { maxMarks: Number(e.target.value) })}
                className={`${fieldInput} tabular`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-caption text-ink-muted">{f.cieWeight(i + 1)}</span>
              <input
                type="number"
                min={1}
                max={100}
                value={c.weight}
                onChange={(e) => setPart(i, { weight: Number(e.target.value) })}
                className={`${fieldInput} tabular`}
              />
            </label>
            <Button
              size="sm"
              variant="quiet"
              aria-label={f.cieRemove(c.name || String(i + 1))}
              onClick={() => setPlan(plan.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </div>
        ))}
        <span className="flex flex-wrap items-center gap-3">
          {plan.length < 8 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setPlan([...plan, { name: '', maxMarks: 25, weight: Math.max(0, 100 - weights) }])
              }
            >
              <Plus aria-hidden className="size-4" />
              {f.cieAdd}
            </Button>
          )}
          {plan.length > 0 && (
            <span
              className={`tabular text-caption ${planOk ? 'text-ink-muted' : 'text-signal-stop-ink'}`}
            >
              {f.cieTotal(weights)}
            </span>
          )}
        </span>
      </fieldset>
    </FormModal>
  );
}

function PublishForm({
  regulation: r,
  onClose,
}: {
  regulation: RegulationView;
  onClose: () => void;
}) {
  const saved = useSaved([['regulation', r.id], ['academics']]);
  const m = useMutation({
    mutationFn: () => api.post(`/academics/regulations/${r.id}/publish`, {}),
    onSuccess: async () => (await saved(), onClose()),
  });
  return (
    <FormModal
      title={t.publish}
      description={`${r.programCode} ${regName(r)}`}
      submitLabel={t.publish}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <div className="flex flex-col gap-3 sm:col-span-2">
        <p className="text-body text-ink">{t.publishLead}</p>
        {r.check.warnings.length > 0 && (
          <>
            <p className="text-body font-medium text-ink">{t.publishWarnings}</p>
            <Checks regulation={r} />
          </>
        )}
      </div>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------------------------

function BatchDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [form, setForm] = useState<'advance' | 'enrol' | 'file' | null>(null);
  const q = useQuery({
    queryKey: ['batch', id],
    queryFn: () => api.get<BatchView>(`/academics/batches/${id}`),
    enabled: !!id,
  });
  const b = q.data;
  const kind = b ? (t.termKinds[b.termKind] ?? b.termKind) : '';
  const running = b?.status === 'running';
  return (
    <RecordDrawer
      open={!!id}
      onOpenChange={(o) => !o && onClose()}
      title={b ? `${b.programCode} ${b.label}` : t.batches}
      {...(b ? { subtitle: `${b.programName} · ${b.regulation}` } : {})}
      closeLabel={en.form.close}
    >
      {!b ? (
        q.error ? (
          <StatePanel kind="error" title={errorText(q.error)} />
        ) : (
          <SkeletonRows rows={5} label={en.states.loading.title} />
        )
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            {running ? (
              <>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-lead font-semibold text-ink">
                    {t.termOf(kind, b.currentTerm, b.terms)}
                  </span>
                  <Pill tone="neutral">{t.parity[b.parity]}</Pill>
                </p>
                {b.startsOn && b.endsOn && (
                  <p className="tabular flex items-center gap-2 text-caption text-ink-muted">
                    <CalendarRange aria-hidden className="size-4" />
                    {date(b.startsOn)} – {date(b.endsOn)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => setForm('enrol')}>
                    <Plus aria-hidden />
                    {t.enrol}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setForm('file')}>
                    <Upload aria-hidden />
                    {t.enrolFile.open}
                  </Button>
                  <Button size="sm" onClick={() => setForm('advance')}>
                    {b.currentTerm >= b.terms ? t.complete : t.advance(kind, b.currentTerm + 1)}
                  </Button>
                </div>
              </>
            ) : (
              <Pill>{t.statuses.completed}</Pill>
            )}
          </div>

          {running && (
            <section aria-labelledby="this-term" className="flex flex-col gap-2">
              <h3 id="this-term" className="font-display text-body font-semibold text-ink">
                {t.thisTerm}
              </h3>
              <p className="text-caption text-ink-muted">
                {t.thisTermLead(termName(b.termKind, b.currentTerm), t.parity[b.parity] ?? '')}
              </p>
              {b.thisTerm.length === 0 ? (
                <p className="text-caption text-ink-muted">{t.noThisTerm}</p>
              ) : (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {b.thisTerm.map((c) => (
                    <li key={c.courseId} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1 text-body text-ink">
                        {c.code} · {c.title}
                        <span className="block text-caption text-ink-muted">{t.kinds[c.kind]}</span>
                      </span>
                      <span className="tabular text-body text-ink">{c.credits}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section aria-labelledby="sections" className="flex flex-col gap-2">
            <h3 id="sections" className="font-display text-body font-semibold text-ink">
              {t.sectionsTitle}
            </h3>
            <ul className="grid grid-cols-2 gap-2">
              {b.sectionList.map((s) => (
                <li key={s.id} className="rounded-lg border border-line px-3 py-2">
                  <p className="font-medium text-ink">{s.name}</p>
                  <p className="tabular text-caption text-ink-muted">
                    {t.seats(s.students, s.capacity)}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="roster" className="flex flex-col gap-2">
            <h3 id="roster" className="font-display text-body font-semibold text-ink">
              {t.roster}{' '}
              <span className="tabular font-normal text-ink-muted">({b.roster.length})</span>
            </h3>
            {b.roster.length === 0 ? (
              <p className="text-caption text-ink-muted">{t.noStudents}</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {b.roster.map((s) => (
                  <li key={s.personId} className="flex items-center gap-3 px-3 py-2">
                    <Link
                      href={`/students/${s.personId}`}
                      className="min-w-0 flex-1 text-body font-medium text-navy-950 underline-offset-2 hover:underline"
                    >
                      {s.name}
                    </Link>
                    <span className="tabular text-caption text-ink-muted">
                      {s.registerNumber ?? dash} · {s.section}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="terms" className="flex flex-col gap-2">
            <h3 id="terms" className="font-display text-body font-semibold text-ink">
              {t.terms}
            </h3>
            <ol className="flex flex-col gap-1">
              {b.termHistory.map((x) => (
                <li key={x.number} className="flex items-center gap-3 text-caption">
                  <span className="w-28 text-ink">{termName(b.termKind, x.number)}</span>
                  <span className="tabular flex-1 text-ink-muted sm:whitespace-nowrap">
                    {date(x.startsOn)} – {date(x.endsOn)}
                  </span>
                  <Pill tone={x.status === 'open' ? 'go' : 'neutral'}>{t.statuses[x.status]}</Pill>
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
      {b && form === 'advance' && <AdvanceForm batch={b} onClose={() => setForm(null)} />}
      {b && form === 'enrol' && <EnrolForm batch={b} onClose={() => setForm(null)} />}
      {b && form === 'file' && <EnrolFileForm batch={b} onClose={() => setForm(null)} />}
    </RecordDrawer>
  );
}

function AdvanceForm({ batch: b, onClose }: { batch: BatchView; onClose: () => void }) {
  const last = b.currentTerm >= b.terms;
  const kind = t.termKinds[b.termKind] ?? b.termKind;
  const [v, setV] = useState({ startsOn: '', endsOn: '' });
  const saved = useSaved([['batch', b.id], ['academics']]);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/batches/${b.id}/advance`, {
        fromTerm: b.currentTerm,
        next: last ? null : v,
      }),
    onSuccess: async () => (await saved(), onClose()),
    onError: (e) => {
      if (e instanceof ApiFailure && e.code === 'term_changed') void saved();
    },
  });
  const title = last ? t.complete : t.advance(kind, b.currentTerm + 1);
  return (
    <FormModal
      title={title}
      description={`${b.programCode} ${b.label}`}
      submitLabel={title}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!last && (!v.startsOn || !v.endsOn || v.endsOn <= v.startsOn)}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <p className="text-body text-ink sm:col-span-2">
        {last
          ? t.completeLead
          : t.advanceLead(
              termName(b.termKind, b.currentTerm),
              termName(b.termKind, b.currentTerm + 1),
            )}
      </p>
      {!last && (
        <>
          <ModalField label={t.nextStarts}>
            <input
              type="date"
              required
              {...(b.endsOn ? { min: b.endsOn } : {})}
              value={v.startsOn}
              onChange={(e) => setV({ ...v, startsOn: e.target.value })}
              className={fieldInput}
            />
          </ModalField>
          <ModalField label={t.nextEnds}>
            <input
              type="date"
              required
              value={v.endsOn}
              onChange={(e) => setV({ ...v, endsOn: e.target.value })}
              className={fieldInput}
            />
          </ModalField>
        </>
      )}
    </FormModal>
  );
}

/**
 * A batch's students from a file (onboarding a college): download the template, choose the file,
 * see every row checked, then enrol the ready ones in one go.
 */
function EnrolFileForm({ batch: b, onClose }: { batch: BatchView; onClose: () => void }) {
  const f = t.enrolFile;
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const saved = useSaved([['batch', b.id], ['academics']]);
  const check = useMutation({
    mutationFn: (text: string) =>
      api.post<EnrolFromFile>(`/academics/batches/${b.id}/enrol-file`, { csv: text, apply: false }),
  });
  const apply = useMutation({
    mutationFn: () =>
      api.post<EnrolFromFile>(`/academics/batches/${b.id}/enrol-file`, { csv, apply: true }),
    onSuccess: async () => (await saved(), onClose()),
  });
  const r = check.data;
  const template = () => {
    const rows = [
      // The columns academics/structure reads (ENROL_COLUMNS); a value import would bundle server code.
      'Name,Register number,Section,Date of birth',
      ...b.sectionList
        .slice(0, 2)
        .map((s, i) => `Student Name ${i + 1},REG00${i + 1},${s.name},15/06/2008`),
    ];
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }));
    Object.assign(document.createElement('a'), {
      href: url,
      download: `${b.programCode}-${b.label}-students.csv`,
    }).click();
    URL.revokeObjectURL(url);
  };
  return (
    <FormModal
      title={f.title}
      description={`${b.programCode} ${b.label} · ${f.lead}`}
      size="xl"
      submitLabel={r ? f.enrol(r.ready) : f.enrol(0)}
      cancelLabel={en.form.cancel}
      pending={apply.isPending}
      submitDisabled={!r || r.ready === 0}
      error={check.error ? errorText(check.error) : apply.isError ? errorText(apply.error) : null}
      onClose={onClose}
      onSubmit={() => apply.mutate()}
    >
      <div className="flex flex-col gap-3 sm:col-span-2">
        <p className="text-caption text-ink-muted">{f.columns}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={template}>
            <Download aria-hidden className="size-4" />
            {f.template}
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-body font-medium text-ink shadow-[var(--shadow-card)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy-950 hover:bg-navy-50">
            <Upload aria-hidden className="size-4" />
            {fileName || f.choose}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const text = await file.text();
                setFileName(file.name);
                setCsv(text);
                check.mutate(text);
              }}
            />
          </label>
        </div>
        {check.isPending && <p className="text-caption text-ink-muted">{f.checking}</p>}
        {r && (
          <>
            <p role="status" className="text-body text-ink">
              {f.summary(r.ready, r.rows.length)}
            </p>
            <div className="max-h-80 overflow-auto rounded-lg border border-line" tabIndex={0}>
              <table className="w-full text-body">
                <caption className="sr-only">{f.title}</caption>
                <thead className="sticky top-0 bg-paper">
                  <tr className="text-left text-caption text-ink-muted">
                    <th scope="col" className="px-3 py-2 font-medium">
                      {f.line}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t.enrolForm.name}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t.enrolForm.register}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t.enrolForm.section}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {f.outcome}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {r.rows.map((row) => (
                    <tr key={row.line}>
                      <td className="tabular px-3 py-1.5 text-ink-muted">{row.line}</td>
                      <th scope="row" className="px-3 py-1.5 text-left font-normal text-ink">
                        {row.name || '—'}
                      </th>
                      <td className="tabular px-3 py-1.5 text-ink">{row.registerNumber ?? '—'}</td>
                      <td className="px-3 py-1.5 text-ink">{row.section || '—'}</td>
                      <td className="px-3 py-1.5">
                        <Pill tone={row.outcome === 'ready' ? 'go' : 'stop'}>
                          {f.outcomes[row.outcome] ?? row.outcome}
                        </Pill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </FormModal>
  );
}

function EnrolForm({ batch: b, onClose }: { batch: BatchView; onClose: () => void }) {
  const f = t.enrolForm;
  const open = b.sectionList.find((s) => s.students < s.capacity) ?? b.sectionList[0];
  const [v, setV] = useState({
    sectionId: open?.id ?? '',
    name: '',
    dateOfBirth: '',
    registerNumber: '',
  });
  const saved = useSaved([['batch', b.id], ['academics']]);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/batches/${b.id}/students`, {
        sectionId: v.sectionId,
        name: v.name,
        dateOfBirth: v.dateOfBirth || null,
        registerNumber: v.registerNumber.trim() || null,
      }),
    onSuccess: async () => (await saved(), onClose()),
  });
  return (
    <FormModal
      title={t.enrol}
      description={`${b.programCode} ${b.label}`}
      submitLabel={t.enrol}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={v.name.trim().length < 2 || !v.sectionId}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={f.name} wide>
        <input
          required
          value={v.name}
          onChange={(e) => setV({ ...v, name: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.section}>
        <select
          value={v.sectionId}
          onChange={(e) => setV({ ...v, sectionId: e.target.value })}
          className={fieldInput}
        >
          {b.sectionList.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {t.seats(s.students, s.capacity)}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.register}>
        <input
          value={v.registerNumber}
          onChange={(e) => setV({ ...v, registerNumber: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.dob}>
        <input
          type="date"
          value={v.dateOfBirth}
          onChange={(e) => setV({ ...v, dateOfBirth: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
