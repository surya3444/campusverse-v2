'use client';

// Students › Mentoring (rule book §13.5, §16.4; docs/specs/MENTORING.md). Mentors see their own
// mentees (concern first), record check-ins and escalate; the head of department balances who
// mentors whom; escalations reach the head of department or the counsellor.
import type {
  Allocation,
  Concern,
  EscalationRow,
  MenteeLog,
  MenteeRow,
} from '@campusverse/shared-mentoring';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  RecordDrawer,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandHeart, Search, Siren, UserRound, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { useUrlTab } from '../common/url-tab';

const t = en.mentoring;
type Tab = 'mine' | 'allocation' | 'escalations';
const errorText = (e: unknown) =>
  (e instanceof ApiFailure ? (e.status === 403 ? t.denied : t.errors[e.code]) : undefined) ??
  t.errors.error ??
  '';
const day = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(d.length === 10 ? `${d}T00:00:00` : d),
  );
const concernTone = (c: Concern | null) =>
  c === 'concern' ? ('stop' as const) : c === 'watch' ? ('warn' as const) : ('go' as const);

export function MentoringView() {
  const { can } = useMe();
  const school = useInstitution();
  const id = school.institutionId ?? null;
  const mentor = can('mentoring.mentee.mentor');
  const manage = can('mentoring.allocation.manage');
  const counsel = can('mentoring.escalation.counsel');
  const tabs: Tab[] = [
    ...(mentor ? (['mine'] as const) : []),
    ...(manage ? (['allocation'] as const) : []),
    ...(manage || counsel ? (['escalations'] as const) : []),
  ];
  const [tab, setTab] = useUrlTab<Tab>(['mine', 'allocation', 'escalations'], 'mine');
  const shown = tabs.includes(tab) ? tab : tabs[0];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={HandHeart}
        area="sky"
        eyebrow={en.systems.groups.students}
        title={t.title}
        description={t.lead}
      >
        {tabs.length > 1 && shown && (
          <Segmented
            label={t.tabsLabel}
            value={shown}
            onChange={setTab}
            options={tabs.map((v) => ({ value: v, label: t.tabs[v] ?? v }))}
          />
        )}
      </PageHeader>
      {!shown ? (
        <StatePanel kind="denied" title={t.denied} body={t.deniedBody} />
      ) : !id ? (
        <SkeletonRows label={t.title} />
      ) : shown === 'mine' ? (
        <Mine institutionId={id} />
      ) : shown === 'allocation' ? (
        <AllocationTab institutionId={id} />
      ) : (
        <Escalations institutionId={id} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// My mentees
// ---------------------------------------------------------------------------------------------

function Mine({ institutionId }: { institutionId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['mentees', institutionId],
    queryFn: () => api.get<MenteeRow[]>(`/mentoring/mentees?institutionId=${institutionId}`),
  });
  if (q.error) return <StatePanel kind="error" title={errorText(q.error)} />;
  if (!q.data) return <SkeletonRows label={t.tabs.mine ?? ''} />;
  if (q.data.length === 0)
    return <EmptyState icon={Users} area="sky" title={t.noMentees} body={t.noMenteesBody} />;
  return (
    <Section id="mentees" title={t.tabs.mine} flush>
      <ul className="divide-y divide-line">
        {q.data.map((m) => (
          <li key={m.personId}>
            <button
              type="button"
              onClick={() => setOpen(m.personId)}
              className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">
                  <span className="sr-only">{t.open}: </span>
                  {m.name}
                </span>
                <span className="text-caption text-ink-muted">
                  {[
                    m.label,
                    m.lastHeld ? t.lastHeld(day(m.lastHeld)) : t.never,
                    m.nextScheduled ? t.next(day(m.nextScheduled)) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="flex flex-wrap gap-2">
                {m.lastConcern && (
                  <Pill tone={concernTone(m.lastConcern)}>{t.concerns[m.lastConcern]}</Pill>
                )}
                {m.due && <Pill tone="warn">{t.due}</Pill>}
                {m.openEscalations > 0 && <Pill tone="stop">{t.escalated(m.openEscalations)}</Pill>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <MenteeDrawer
          institutionId={institutionId}
          studentId={open}
          onClose={() => setOpen(null)}
        />
      )}
    </Section>
  );
}

type Form = { kind: 'record'; meetingId?: string } | { kind: 'schedule' } | { kind: 'escalate' };

function MenteeDrawer({
  institutionId,
  studentId,
  onClose,
}: {
  institutionId: string;
  studentId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['mentee', studentId],
    queryFn: () =>
      api.get<MenteeLog>(`/mentoring/mentees/${studentId}?institutionId=${institutionId}`),
  });
  const done = async (msg: string) => {
    setForm(null);
    setNote(msg);
    for (const k of ['mentee', 'mentees', 'mentor-escalations'])
      await qc.invalidateQueries({ queryKey: [k] });
  };
  const l = t.log;
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={q.data?.name ?? t.title}
      subtitle={[q.data?.label, q.data?.mentor ? l.mentor(q.data.mentor) : null]
        .filter(Boolean)
        .join(' · ')}
      closeLabel={l.close}
    >
      <Announcer message={note} />
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !q.data ? (
        <SkeletonRows label={t.title} />
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setForm({ kind: 'record' })}>
              {l.record}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setForm({ kind: 'schedule' })}>
              {l.schedule}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setForm({ kind: 'escalate' })}>
              <Siren aria-hidden />
              {l.escalate}
            </Button>
          </div>
          <section aria-labelledby="mentee-checkins" className="flex flex-col gap-2">
            <h3 id="mentee-checkins" className="font-display text-lead font-semibold text-ink">
              {l.checkIns}
            </h3>
            {q.data.meetings.length === 0 ? (
              <p className="text-body text-ink-muted">{l.none}</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line">
                {q.data.meetings.map((m) => (
                  <li key={m.id} className="flex flex-col gap-1 py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-caption text-ink-muted">{day(m.scheduledFor)}</span>
                      <Pill
                        tone={
                          m.state === 'held' ? 'go' : m.state === 'scheduled' ? 'warn' : 'neutral'
                        }
                      >
                        {l.states[m.state]}
                      </Pill>
                      {m.concern && (
                        <Pill tone={concernTone(m.concern)}>{t.concerns[m.concern]}</Pill>
                      )}
                      {m.state === 'scheduled' && (
                        <Button
                          variant="quiet"
                          size="sm"
                          onClick={() => setForm({ kind: 'record', meetingId: m.id })}
                        >
                          {l.recordThis}
                        </Button>
                      )}
                    </span>
                    {m.notes && <span className="text-body text-ink">{m.notes}</span>}
                  </li>
                ))}
              </ol>
            )}
          </section>
          {q.data.escalations.length > 0 && (
            <section aria-labelledby="mentee-escalations" className="flex flex-col gap-2">
              <h3 id="mentee-escalations" className="font-display text-lead font-semibold text-ink">
                {l.escalations}
              </h3>
              <EscalationList rows={q.data.escalations} />
            </section>
          )}
        </div>
      )}
      {form?.kind === 'record' && (
        <RecordForm
          institutionId={institutionId}
          studentId={studentId}
          meetingId={form.meetingId}
          onClose={() => setForm(null)}
          onDone={() => done(t.record.saved)}
        />
      )}
      {form?.kind === 'schedule' && (
        <ScheduleForm
          institutionId={institutionId}
          studentId={studentId}
          onClose={() => setForm(null)}
          onDone={() => done(t.scheduleForm.saved)}
        />
      )}
      {form?.kind === 'escalate' && (
        <EscalateForm
          institutionId={institutionId}
          studentId={studentId}
          onClose={() => setForm(null)}
          onDone={() => done(t.escalate.saved)}
        />
      )}
    </RecordDrawer>
  );
}

function RecordForm({
  institutionId,
  studentId,
  meetingId,
  onClose,
  onDone,
}: {
  institutionId: string;
  studentId: string;
  meetingId?: string | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const r = t.record;
  const [state, setState] = useState<'held' | 'missed' | 'cancelled'>('held');
  const [notes, setNotes] = useState('');
  const [concern, setConcern] = useState<Concern>('fine');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/mentoring/mentees/${studentId}/check-ins`, {
        institutionId,
        ...(meetingId ? { meetingId } : {}),
        state,
        notes: notes.trim() || null,
        concern: state === 'held' ? concern : null,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={r.title}
      submitLabel={r.save}
      cancelLabel={t.log.close}
      pending={save.isPending}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={r.held}>
        <select
          className={fieldInput}
          value={state}
          onChange={(e) => setState(e.target.value as typeof state)}
        >
          {(['held', 'missed', 'cancelled'] as const).map((s) => (
            <option key={s} value={s}>
              {r.state[s]}
            </option>
          ))}
        </select>
      </ModalField>
      {state === 'held' && (
        <ModalField label={r.concern}>
          <select
            className={fieldInput}
            value={concern}
            onChange={(e) => setConcern(e.target.value as Concern)}
          >
            {(['fine', 'watch', 'concern'] as const).map((c) => (
              <option key={c} value={c}>
                {t.concerns[c]}
              </option>
            ))}
          </select>
        </ModalField>
      )}
      <ModalField label={r.notes} hint={r.notesHint} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={4}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function ScheduleForm({
  institutionId,
  studentId,
  onClose,
  onDone,
}: {
  institutionId: string;
  studentId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const s = t.scheduleForm;
  const [on, setOn] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/mentoring/mentees/${studentId}/schedule`, { institutionId, on }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={s.title}
      submitLabel={s.save}
      cancelLabel={t.log.close}
      pending={save.isPending}
      submitDisabled={!on}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={s.on}>
        <input
          className={fieldInput}
          type="date"
          value={on}
          onChange={(e) => setOn(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function EscalateForm({
  institutionId,
  studentId,
  onClose,
  onDone,
}: {
  institutionId: string;
  studentId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const e = t.escalate;
  const [to, setTo] = useState<'hod' | 'counsellor' | 'parent'>('hod');
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/mentoring/mentees/${studentId}/escalate`, { institutionId, to, reason }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={e.title}
      submitLabel={e.save}
      cancelLabel={t.log.close}
      pending={save.isPending}
      submitDisabled={reason.trim().length < 10}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={e.to} {...(to === 'parent' ? { hint: e.parentHint } : {})} wide>
        <select
          className={fieldInput}
          value={to}
          onChange={(ev) => setTo(ev.target.value as typeof to)}
        >
          {(['hod', 'counsellor', 'parent'] as const).map((k) => (
            <option key={k} value={k}>
              {e.targets[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={e.reason} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={4}
          maxLength={1000}
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Allocation (the head of department)
// ---------------------------------------------------------------------------------------------

function AllocationTab({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const a = t.allocation;
  const [mentorId, setMentorId] = useState('');
  const [onlyFree, setOnlyFree] = useState(true);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['mentoring-allocation', institutionId],
    queryFn: () => api.get<Allocation>(`/mentoring/allocation?institutionId=${institutionId}`),
  });
  const shown = useMemo(() => {
    const s = text.trim().toLowerCase();
    return (q.data?.students ?? []).filter(
      (x) =>
        (!onlyFree || !x.mentor) &&
        (!s || x.name.toLowerCase().includes(s) || (x.label ?? '').toLowerCase().includes(s)),
    );
  }, [q.data, onlyFree, text]);
  const assign = useMutation({
    mutationFn: () =>
      api.post<{ assigned: number }>('/mentoring/assign', {
        institutionId,
        mentorId,
        studentIds: [...picked],
      }),
    onSuccess: async (r) => {
      setPicked(new Set());
      setNote(a.assigned(r.assigned));
      await qc.invalidateQueries({ queryKey: ['mentoring-allocation'] });
    },
  });
  if (q.error) return <StatePanel kind="error" title={errorText(q.error)} />;
  if (!q.data) return <SkeletonRows label={t.tabs.allocation ?? ''} />;
  const s = q.data.summary;
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="flex flex-col gap-6">
      <Announcer message={note} />
      <KeyFigures
        label={a.figures}
        figures={[
          { label: a.mentors, icon: Users, value: String(s.mentors) },
          { label: a.average, icon: UserRound, value: s.average.toLocaleString('en-IN') },
          { label: a.highest, icon: UserRound, value: String(s.highest) },
          {
            label: a.unassigned,
            icon: HandHeart,
            value: String(s.unassigned),
            ...(s.unassigned > 0 ? { tone: 'warn' as const } : {}),
          },
        ]}
      />
      <Section
        id="mentoring-assign"
        title={a.students}
        flush
        actions={
          <Button
            size="sm"
            disabled={!mentorId || picked.size === 0 || assign.isPending}
            onClick={() => assign.mutate()}
          >
            {a.assign(picked.size)}
          </Button>
        }
      >
        <div className="flex flex-wrap items-end gap-4 border-b border-line px-5 py-4">
          <label className="flex min-w-60 flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{a.mentor}</span>
            <select
              className={fieldInput}
              value={mentorId}
              onChange={(e) => setMentorId(e.target.value)}
            >
              <option value="">{a.pickMentor}</option>
              {q.data.mentors.map((m) => (
                <option key={m.personId} value={m.personId}>
                  {m.name} · {a.load(m.mentees)}
                </option>
              ))}
            </select>
          </label>
          <label className="relative flex min-w-56 flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{a.search}</span>
            <Search
              aria-hidden
              className="pointer-events-none absolute bottom-3 left-3 size-4 text-ink-muted"
            />
            <input
              className={cx(fieldInput, 'pl-9')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 pb-2.5">
            <input
              type="checkbox"
              className="size-4 accent-navy-950"
              checked={onlyFree}
              onChange={(e) => setOnlyFree(e.target.checked)}
            />
            <span className="text-body text-ink">{a.onlyUnassigned}</span>
          </label>
        </div>
        {assign.error && (
          <p role="alert" className="px-5 pt-3 text-body text-signal-stop-ink">
            {errorText(assign.error)}
          </p>
        )}
        {shown.length === 0 ? (
          <p className="px-5 py-4 text-body text-ink-muted">{a.none}</p>
        ) : (
          <ul className="max-h-[32rem] divide-y divide-line overflow-auto" tabIndex={0}>
            {shown.map((x) => (
              <li key={x.personId}>
                <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-paper">
                  <input
                    type="checkbox"
                    className="size-4 accent-navy-950"
                    checked={picked.has(x.personId)}
                    onChange={() => toggle(x.personId)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-ink">{x.name}</span>
                    <span className="text-caption text-ink-muted">{x.label}</span>
                  </span>
                  <span className="text-caption text-ink-muted">{x.mentor ?? a.noMentor}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Escalations
// ---------------------------------------------------------------------------------------------

function EscalationList({
  rows,
  onClose,
}: {
  rows: EscalationRow[];
  onClose?: (row: EscalationRow) => void;
}) {
  const e = t.escalations;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id} className="flex flex-col gap-1.5 py-3">
          <span className="flex flex-wrap items-center gap-2">
            <Pill tone={r.state === 'open' ? 'stop' : 'neutral'}>
              {r.state === 'open' ? e.openState : e.closedState}
            </Pill>
            <span className="font-medium text-ink">{r.student}</span>
            {r.label && <span className="text-caption text-ink-muted">{r.label}</span>}
            <Pill>{t.escalate.targets[r.to]}</Pill>
          </span>
          <span className="text-body text-ink">{r.reason}</span>
          <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-caption text-ink-muted">
              {e.raised(r.raisedBy, day(r.createdAt))}
            </span>
            {r.state === 'open' && onClose && (
              <Button size="sm" variant="secondary" onClick={() => onClose(r)}>
                {e.close}
                <span className="sr-only"> {r.student}</span>
              </Button>
            )}
          </span>
          {r.closingNote && (
            <span className="text-caption text-ink-muted">
              {r.closedBy}: {r.closingNote}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Escalations({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const e = t.escalations;
  const [closing, setClosing] = useState<EscalationRow | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['mentor-escalations', institutionId],
    queryFn: () =>
      api.get<EscalationRow[]>(`/mentoring/escalations?institutionId=${institutionId}`),
  });
  const close = useMutation({
    mutationFn: () =>
      api.post(`/mentoring/escalations/${closing?.id}/close`, { institutionId, note: text }),
    onSuccess: async () => {
      setClosing(null);
      setText('');
      setNote(e.closed);
      await qc.invalidateQueries({ queryKey: ['mentor-escalations'] });
    },
  });
  if (q.error) return <StatePanel kind="error" title={errorText(q.error)} />;
  if (!q.data) return <SkeletonRows label={t.tabs.escalations ?? ''} />;
  return (
    <>
      <Announcer message={note} />
      {q.data.length === 0 ? (
        <EmptyState icon={Siren} area="sky" title={e.none} body={e.noneBody} />
      ) : (
        <Section id="mentor-escalations" title={t.tabs.escalations}>
          <EscalationList rows={q.data} onClose={setClosing} />
        </Section>
      )}
      {closing && (
        <FormModal
          title={`${e.close}: ${closing.student}`}
          submitLabel={e.close}
          cancelLabel={t.log.close}
          pending={close.isPending}
          submitDisabled={text.trim().length < 3}
          error={close.error ? errorText(close.error) : null}
          size="md"
          onClose={() => setClosing(null)}
          onSubmit={() => close.mutate()}
        >
          <ModalField label={e.note} wide>
            <textarea
              className={cx(fieldInput, 'h-auto py-2')}
              rows={3}
              maxLength={1000}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
            />
          </ModalField>
        </FormModal>
      )}
    </>
  );
}
