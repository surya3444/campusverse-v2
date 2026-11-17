'use client';

// Academics › Course Registration (rule book §13.2, §16.6 step 2): a batch's current term, its
// window with credit limits and elective seats, and every student's registration with an
// approver's decision. Only the batch's current term is ever offered.
import type { StructureOverview } from '@campusverse/academics-structure';
import type { RegistrationBoard, SelectionProblem } from '@campusverse/academics-registration';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Clock,
  Lock,
  UserX,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';

const t = en.registration;
const a = en.academics;
const dash = '—';
const date = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(
    new Date(`${d.slice(0, 10)}T00:00:00`),
  );
const problemText = (p: SelectionProblem) =>
  p.kind === 'full'
    ? t.problem.full(p.code)
    : p.kind === 'below_min'
      ? t.problem.below_min(p.credits, p.min)
      : p.kind === 'above_max'
        ? t.problem.above_max(p.credits, p.max)
        : t.problem.not_offered;
const errorText = (e: unknown): string => {
  if (!(e instanceof ApiFailure)) return t.errors.error ?? '';
  if (e.status === 403) return t.errors.forbidden ?? '';
  if (e.code === 'selection' && Array.isArray(e.details))
    return (e.details as SelectionProblem[]).map(problemText).join(' ');
  return t.errors[e.code] ?? t.errors.error ?? '';
};
const STATUS_TONE: Record<string, Tone> = {
  none: 'neutral',
  submitted: 'warn',
  approved: 'go',
  returned: 'stop',
};

type Student = RegistrationBoard['students'][number];

export function RegistrationView() {
  const school = useInstitution();
  const id = school.institutionId;
  const me = useMe();
  const [chosen, setChosen] = useState<string | null>(null);
  const [form, setForm] = useState<
    | { kind: 'window' }
    | { kind: 'register'; student: Student }
    | { kind: 'return'; student: Student }
    | null
  >(null);
  const overview = useQuery({
    queryKey: ['academics', id],
    queryFn: () => api.get<StructureOverview>(`/academics/structure?institutionId=${id}`),
    enabled: !!id,
  });
  const batches = overview.data?.batches.filter((b) => b.status === 'running') ?? [];
  const batchId = batches.find((b) => b.id === chosen)?.id ?? batches[0]?.id;
  const q = useQuery({
    queryKey: ['registration', batchId],
    queryFn: () => api.get<RegistrationBoard>(`/academics/batches/${batchId}/registration`),
    enabled: !!batchId,
  });
  const qc = useQueryClient();
  const decide = useMutation({
    mutationFn: (registrationId: string) =>
      api.post(`/academics/registrations/${registrationId}/decision`, {
        decision: 'approve',
        note: null,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['registration', batchId] }),
  });
  const d = q.data;
  const error = overview.error ?? q.error;
  const denied = error instanceof ApiFailure && error.status === 403;
  const isSchool = overview.data?.profile === 'school';
  const canManage = me.can('academics.registration.manage');
  const count = (s: string) =>
    d?.students.filter((x) => (x.registration?.status ?? 'none') === s).length ?? 0;
  const windowState = d?.window
    ? d.window.open
      ? 'open'
      : d.window.upcoming
        ? 'upcoming'
        : 'closed'
    : null;
  const kind = d ? (a.termKinds[d.batch.termKind] ?? d.batch.termKind) : '';
  const electives = d?.courses.filter((c) => c.chosen) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ClipboardList}
        area="violet"
        eyebrow={en.systems.groups.academics}
        title={t.title}
        description={t.lead}
        actions={
          batches.length > 0 ? (
            <label className="flex items-center gap-2 text-body text-ink">
              <span className="text-caption font-medium text-ink-muted">{t.batch}</span>
              <select
                value={batchId}
                onChange={(e) => setChosen(e.target.value)}
                className={`${fieldInput} min-w-56`}
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.programCode} {b.label}
                  </option>
                ))}
              </select>
            </label>
          ) : undefined
        }
      >
        {d && (
          <Pill>
            {t.termChip(
              a.termOf(
                kind,
                d.batch.currentTerm,
                overview.data?.batches.find((b) => b.id === batchId)?.terms ?? d.batch.currentTerm,
              ),
              a.parity[d.batch.parity] ?? '',
            )}
          </Pill>
        )}
      </PageHeader>
      {denied ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={t.errors.forbidden ?? ''} />
      ) : error ? (
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
            icon={ClipboardList}
            area="violet"
            title={t.schoolTitle}
            body={t.schoolBody}
          />
        </Section>
      ) : overview.data && batches.length === 0 ? (
        <Section>
          <EmptyState
            icon={ClipboardList}
            area="violet"
            title={t.noBatches}
            body={t.noBatchesBody}
            actions={
              <Link
                href="/academic-structure"
                className="inline-flex h-10 items-center rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-950/90"
              >
                {t.openStructure}
              </Link>
            }
          />
        </Section>
      ) : !d ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : (
        <>
          <Section
            id="window"
            title={t.window}
            description={t.windowLead}
            actions={
              canManage ? (
                <Button
                  variant={d.window ? 'secondary' : 'primary'}
                  size="sm"
                  onClick={() => setForm({ kind: 'window' })}
                >
                  <CalendarRange aria-hidden />
                  {d.window ? t.changeWindow : t.openWindow}
                </Button>
              ) : undefined
            }
          >
            {d.window ? (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-body text-ink">
                <Pill
                  tone={
                    windowState === 'open' ? 'go' : windowState === 'upcoming' ? 'warn' : 'neutral'
                  }
                >
                  {t.windowStates[windowState ?? 'closed']}
                </Pill>
                <span className="tabular">
                  {t.windowDates(date(d.window.opensOn), date(d.window.closesOn))}
                </span>
                <span className="tabular text-ink-muted">
                  {t.limits(d.window.minCredits, d.window.maxCredits)}
                </span>
              </p>
            ) : (
              <p className="text-body text-ink-muted">{t.noWindow}</p>
            )}
          </Section>

          <KeyFigures
            label={t.figures}
            figures={[
              { label: t.fig.students, icon: Users, value: String(d.students.length) },
              {
                label: t.fig.notStarted,
                icon: UserX,
                value: String(count('none') + count('returned')),
              },
              {
                label: t.fig.waiting,
                icon: Clock,
                value: String(count('submitted')),
                ...(count('submitted') ? { tone: 'warn' as const } : {}),
              },
              { label: t.fig.approved, icon: CheckCircle2, value: String(count('approved')) },
            ]}
          />

          <Section id="electives" title={t.electives} description={t.electivesLead} flush>
            {electives.length === 0 ? (
              <p className="px-6 py-5 text-body text-ink-muted">{t.noElectives}</p>
            ) : (
              <ul className="divide-y divide-line">
                {electives.map((c) => (
                  <li key={c.courseId} className="flex flex-wrap items-center gap-3 px-6 py-3">
                    <span className="min-w-0 flex-1 text-body text-ink">
                      <span className="font-medium">{c.code}</span> · {c.title}
                      <span className="block text-caption text-ink-muted">
                        {a.kinds[c.kind]} · {a.credits(c.credits)}
                      </span>
                    </span>
                    <span className="tabular text-caption text-ink-muted">
                      {t.seats(c.taken, c.seats)}
                    </span>
                    {c.seats !== null && (
                      <span
                        aria-hidden
                        className="h-1.5 w-24 overflow-hidden rounded-full bg-navy-50"
                      >
                        <span
                          className="block h-full rounded-full bg-navy-950"
                          style={{ width: `${Math.min(100, (c.taken / c.seats) * 100)}%` }}
                        />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section id="students" title={t.students} flush>
            {d.students.length === 0 ? (
              <p className="px-6 py-5 text-body text-ink-muted">{t.noStudents}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-body">
                  <caption className="sr-only">{t.students}</caption>
                  <thead>
                    <tr className="border-b border-line bg-paper text-left text-caption tracking-wide whitespace-nowrap text-ink-muted uppercase">
                      {[
                        t.table.student,
                        t.table.section,
                        t.table.chosen,
                        t.table.credits,
                        t.table.status,
                      ].map((h) => (
                        <th key={h} scope="col" className="px-5 py-2 font-medium">
                          {h}
                        </th>
                      ))}
                      <th scope="col" className="px-5 py-2 text-right font-medium">
                        {t.table.actions}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.students.map((s) => {
                      const r = s.registration;
                      const status = r?.status ?? 'none';
                      const codes = d.courses
                        .filter((c) => c.chosen && r?.courseIds.includes(c.courseId))
                        .map((c) => c.code);
                      return (
                        <tr key={s.personId}>
                          <th scope="row" className="px-5 py-3 text-left font-normal">
                            <Link
                              href={`/students/${s.personId}`}
                              className="font-medium text-navy-950 underline-offset-2 hover:underline"
                            >
                              {s.name}
                            </Link>
                            {s.registerNumber && (
                              <span className="tabular block text-caption text-ink-muted">
                                {s.registerNumber}
                              </span>
                            )}
                          </th>
                          <td className="px-5 py-3 text-ink">{s.section}</td>
                          <td className="px-5 py-3 text-ink">
                            {codes.length ? codes.join(', ') : dash}
                          </td>
                          <td className="tabular px-5 py-3 text-ink">{r ? r.credits : dash}</td>
                          <td className="px-5 py-3">
                            <Pill tone={STATUS_TONE[status] ?? 'neutral'}>
                              {t.statuses[status]}
                            </Pill>
                            {r?.status === 'returned' && r.note && (
                              <span className="mt-1 block max-w-64 text-caption text-ink-muted">
                                {r.note}
                              </span>
                            )}
                            {r?.status === 'submitted' && r.approval?.status === 'pending' && (
                              <span className="mt-1 block text-caption text-ink-muted">
                                {en.workflow.progress(
                                  r.approval.step,
                                  r.approval.steps,
                                  r.approval.stepRoleName ?? en.workflow.anyApprover,
                                )}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <span className="flex flex-wrap justify-end gap-2">
                              {r?.status === 'submitted' && r.approval?.mine && (
                                <>
                                  <Button
                                    size="sm"
                                    aria-label={t.approveFor(s.name)}
                                    disabled={decide.isPending}
                                    onClick={() => decide.mutate(r.id)}
                                  >
                                    {t.approve}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    aria-label={t.returnFor(s.name)}
                                    onClick={() => setForm({ kind: 'return', student: s })}
                                  >
                                    {t.returnIt}
                                  </Button>
                                </>
                              )}
                              {canManage && d.window?.open && (
                                <Button
                                  size="sm"
                                  variant={r ? 'quiet' : 'secondary'}
                                  aria-label={r ? t.changeFor(s.name) : t.registerFor(s.name)}
                                  onClick={() => setForm({ kind: 'register', student: s })}
                                >
                                  {r ? t.change : t.register}
                                </Button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {decide.isError && (
              <p role="alert" className="px-6 pb-4 text-caption text-signal-stop-ink">
                {errorText(decide.error)}
              </p>
            )}
          </Section>
        </>
      )}
      {d && form?.kind === 'window' && <WindowForm board={d} onClose={() => setForm(null)} />}
      {d && form?.kind === 'register' && (
        <RegisterForm board={d} student={form.student} onClose={() => setForm(null)} />
      )}
      {d && form?.kind === 'return' && form.student.registration && (
        <ReturnForm board={d} student={form.student} onClose={() => setForm(null)} />
      )}
    </div>
  );
}

function useSaved(batchId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['registration', batchId] });
}

function WindowForm({ board: d, onClose }: { board: RegistrationBoard; onClose: () => void }) {
  const f = t.windowForm;
  const w = d.window;
  const [v, setV] = useState({
    opensOn: w?.opensOn ?? '',
    closesOn: w?.closesOn ?? '',
    min: w?.minCredits ?? d.defaults.min,
    max: w?.maxCredits ?? d.defaults.max,
  });
  const electives = d.courses.filter((c) => c.chosen);
  const [caps, setCaps] = useState<Record<string, string>>(
    Object.fromEntries(electives.map((c) => [c.courseId, c.seats === null ? '' : String(c.seats)])),
  );
  const saved = useSaved(d.batch.id);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/batches/${d.batch.id}/registration/window`, {
        opensOn: v.opensOn,
        closesOn: v.closesOn,
        minCredits: v.min,
        maxCredits: v.max,
        caps: Object.entries(caps)
          .filter(([, s]) => s.trim() !== '')
          .map(([courseId, s]) => ({ courseId, seats: Number(s) })),
      }),
    onSuccess: async () => (await saved(), onClose()),
  });
  const title = w ? t.changeWindow : t.openWindow;
  return (
    <FormModal
      title={title}
      description={d.batch.name}
      submitLabel={title}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!v.opensOn || !v.closesOn || v.closesOn < v.opensOn || v.max < v.min}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={f.opensOn}>
        <input
          type="date"
          required
          value={v.opensOn}
          onChange={(e) => setV({ ...v, opensOn: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.closesOn}>
        <input
          type="date"
          required
          {...(d.defaults.closesBy ? { max: d.defaults.closesBy } : {})}
          value={v.closesOn}
          onChange={(e) => setV({ ...v, closesOn: e.target.value })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.min} hint={f.limitsHint(d.defaults.min, d.defaults.max)}>
        <input
          type="number"
          min={0}
          max={60}
          step="0.5"
          value={v.min}
          onChange={(e) => setV({ ...v, min: Number(e.target.value) })}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={f.max}>
        <input
          type="number"
          min={0}
          max={60}
          step="0.5"
          value={v.max}
          onChange={(e) => setV({ ...v, max: Number(e.target.value) })}
          className={fieldInput}
        />
      </ModalField>
      {electives.map((c) => (
        <ModalField key={c.courseId} label={f.seats(c.code)} hint={f.seatsHint}>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={caps[c.courseId] ?? ''}
            onChange={(e) => setCaps({ ...caps, [c.courseId]: e.target.value })}
            className={fieldInput}
          />
        </ModalField>
      ))}
    </FormModal>
  );
}

function RegisterForm({
  board: d,
  student: s,
  onClose,
}: {
  board: RegistrationBoard;
  student: Student;
  onClose: () => void;
}) {
  const w = d.window;
  const mine = new Set(
    s.registration?.status === 'returned' ? [] : (s.registration?.courseIds ?? []),
  );
  const [chosen, setChosen] = useState<string[]>(
    d.courses
      .filter((c) => c.chosen && s.registration?.courseIds.includes(c.courseId))
      .map((c) => c.courseId),
  );
  const compulsory = d.courses.filter((c) => !c.chosen);
  const electives = d.courses.filter((c) => c.chosen);
  const credits =
    Math.round(
      [...compulsory, ...electives.filter((c) => chosen.includes(c.courseId))].reduce(
        (n, c) => n + c.credits,
        0,
      ) * 10,
    ) / 10;
  const inRange = w ? credits >= w.minCredits && credits <= w.maxCredits : false;
  const saved = useSaved(d.batch.id);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/batches/${d.batch.id}/registration`, {
        studentId: s.personId,
        electiveIds: chosen,
      }),
    onSuccess: async () => (await saved(), onClose()),
  });
  const title = s.registration ? t.changeFor(s.name) : t.registerFor(s.name);
  return (
    <FormModal
      title={title}
      description={`${d.batch.name}${s.registerNumber ? ` · ${s.registerNumber}` : ''}`}
      size="lg"
      submitLabel={s.registration ? t.change : t.register}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={!inRange}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <div className="flex flex-col gap-2 sm:col-span-2">
        <p className="text-caption font-medium text-ink">{t.compulsory}</p>
        <ul className="divide-y divide-line rounded-lg border border-line">
          {compulsory.map((c) => (
            <li key={c.courseId} className="flex items-center gap-3 px-3 py-2">
              <Lock aria-hidden className="size-4 shrink-0 text-ink-muted" />
              <span className="min-w-0 flex-1 text-body text-ink">
                {c.code} · {c.title}
                <span className="block text-caption text-ink-muted">{a.kinds[c.kind]}</span>
              </span>
              <span className="tabular text-body text-ink">{c.credits}</span>
            </li>
          ))}
        </ul>
      </div>
      {electives.length > 0 && (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-2 text-caption font-medium text-ink">{t.choose}</legend>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {electives.map((c) => {
              const left =
                c.seats === null ? null : c.seats - c.taken + (mine.has(c.courseId) ? 1 : 0);
              const full = left !== null && left <= 0 && !chosen.includes(c.courseId);
              return (
                <li key={c.courseId}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 has-disabled:cursor-not-allowed has-disabled:opacity-60">
                    <input
                      type="checkbox"
                      className="size-4 accent-navy-950"
                      checked={chosen.includes(c.courseId)}
                      disabled={full}
                      onChange={(e) =>
                        setChosen(
                          e.target.checked
                            ? [...chosen, c.courseId]
                            : chosen.filter((x) => x !== c.courseId),
                        )
                      }
                    />
                    <span className="min-w-0 flex-1 text-body text-ink">
                      {c.code} · {c.title}
                      <span className="block text-caption text-ink-muted">
                        {a.kinds[c.kind]}
                        {left !== null && ` · ${t.seatsLeft(left)}`}
                      </span>
                    </span>
                    <span className="tabular text-body text-ink">{c.credits}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}
      {w && (
        <p
          role="status"
          className={`tabular rounded-lg px-3 py-2 text-caption sm:col-span-2 ${inRange ? 'bg-signal-go-tint text-signal-go-ink' : 'bg-signal-warn-tint text-signal-warn-ink'}`}
        >
          {t.total(credits, w.minCredits, w.maxCredits)}
        </p>
      )}
    </FormModal>
  );
}

function ReturnForm({
  board: d,
  student: s,
  onClose,
}: {
  board: RegistrationBoard;
  student: Student;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const saved = useSaved(d.batch.id);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/academics/registrations/${s.registration?.id}/decision`, {
        decision: 'return',
        note,
      }),
    onSuccess: async () => (await saved(), onClose()),
  });
  return (
    <FormModal
      title={t.returnTitle}
      description={s.name}
      submitLabel={t.returnIt}
      cancelLabel={en.form.cancel}
      pending={m.isPending}
      submitDisabled={note.trim().length === 0}
      error={m.isError ? errorText(m.error) : null}
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <ModalField label={t.returnNote} wide>
        <textarea
          required
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
