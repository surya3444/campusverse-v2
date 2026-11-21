'use client';

// Quality & Compliance › Grievances & Committees (rule book §13.11, §15). Anyone raises a case
// with the right committee and follows it; committee members work their committee's cases; leaders
// set committees up and see counts, never cases (POSH confidentiality).
import type {
  CaseDetail,
  CaseRow,
  CommitteeKind,
  CommitteeRow,
} from '@campusverse/shared-grievances';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
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
import { Plus, Scale, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { useUrlTab } from '../common/url-tab';

const t = en.grievances;
type Tab = 'mine' | 'committee' | 'setup';
const KINDS: CommitteeKind[] = [
  'internal_complaints',
  'anti_ragging',
  'grievance_redressal',
  'sc_st_cell',
  'other',
];
const errorText = (e: unknown) =>
  (e instanceof ApiFailure ? t.errors[e.code] : undefined) ?? t.errors.error ?? '';
const day = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(d.length === 10 ? `${d}T00:00:00` : d),
  );
const stateTone = (s: string) =>
  s === 'closed' ? ('neutral' as const) : s === 'decided' ? ('go' as const) : ('warn' as const);

function useCommittees(institutionId: string | null) {
  return useQuery({
    queryKey: ['grievance-committees', institutionId],
    queryFn: () => api.get<CommitteeRow[]>(`/grievances/committees?institutionId=${institutionId}`),
    enabled: !!institutionId,
  });
}

export function GrievancesView() {
  const { can } = useMe();
  const school = useInstitution();
  const id = school.institutionId ?? null;
  const manage = can('grievance.committee.manage');
  const raise = can('grievance.case.raise');
  const list = useCommittees(id);
  const sits = (list.data ?? []).some((c) => c.member);
  const tabs: Tab[] = [
    'mine',
    ...(sits ? (['committee'] as const) : []),
    ...(manage ? (['setup'] as const) : []),
  ];
  const [tab, setTab] = useUrlTab<Tab>(['mine', 'committee', 'setup'], 'mine');
  const shown: Tab = tabs.includes(tab) ? tab : 'mine';
  const [raising, setRaising] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Scale}
        area="navy"
        eyebrow={en.systems.groups.quality}
        title={t.title}
        description={t.lead}
        actions={
          raise ? (
            <Button onClick={() => setRaising(true)} disabled={!id}>
              <Plus aria-hidden />
              {t.raise}
            </Button>
          ) : undefined
        }
      >
        {tabs.length > 1 && (
          <Segmented
            label={t.tabsLabel}
            value={shown}
            onChange={setTab}
            options={tabs.map((v) => ({ value: v, label: t.tabs[v] }))}
          />
        )}
      </PageHeader>
      <Announcer message={note} />
      {!id ? (
        <SkeletonRows label={t.title} />
      ) : shown === 'mine' ? (
        <MyCases institutionId={id} />
      ) : shown === 'committee' ? (
        <CommitteeWork institutionId={id} committees={(list.data ?? []).filter((c) => c.member)} />
      ) : (
        <Setup institutionId={id} />
      )}
      {raising && id && (
        <RaiseForm
          institutionId={id}
          committees={(list.data ?? []).filter((c) => c.active)}
          onClose={() => setRaising(false)}
          onDone={(n) => {
            setRaising(false);
            setNote(t.raised(n));
          }}
        />
      )}
    </div>
  );
}

function CaseList({ rows, onOpen }: { rows: CaseRow[]; onOpen: (id: string) => void }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => onOpen(c.id)}
            className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper focus-visible:outline-2 focus-visible:outline-navy-950"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-ink">
                <span className="tabular text-ink-muted">#{c.number} </span>
                {c.subject}
              </span>
              <span className="text-caption text-ink-muted">
                {[c.committee, t.case.raisedBy(c.raisedBy, day(c.receivedOn))].join(' · ')}
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              {c.overdue && <Pill tone="stop">{t.overdue}</Pill>}
              {(c.state === 'received' || c.state === 'inquiry') && !c.overdue && (
                <Pill>{t.due(day(c.dueOn))}</Pill>
              )}
              <Pill tone={stateTone(c.state)}>{t.states[c.state]}</Pill>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MyCases({ institutionId }: { institutionId: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['grievances-mine', institutionId],
    queryFn: () => api.get<CaseRow[]>(`/grievances/mine?institutionId=${institutionId}`),
  });
  if (q.error) return <StatePanel kind="error" title={errorText(q.error)} />;
  if (!q.data) return <SkeletonRows label={t.tabs.mine} />;
  return (
    <>
      {q.data.length === 0 ? (
        <EmptyState icon={Scale} area="navy" title={t.noCases} body={t.noCasesBody} />
      ) : (
        <Section id="grievances-mine" title={t.tabs.mine} flush>
          <CaseList rows={q.data} onOpen={setOpen} />
        </Section>
      )}
      {open && (
        <CaseDrawer institutionId={institutionId} caseId={open} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function CommitteeWork({
  institutionId,
  committees,
}: {
  institutionId: string;
  committees: CommitteeRow[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [meetingFor, setMeetingFor] = useState<CommitteeRow | null>(null);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <Announcer message={note} />
      {committees.map((c) => (
        <CommitteeCases
          key={c.id}
          institutionId={institutionId}
          committee={c}
          onOpen={setOpen}
          onMeeting={() => setMeetingFor(c)}
        />
      ))}
      {open && (
        <CaseDrawer institutionId={institutionId} caseId={open} onClose={() => setOpen(null)} />
      )}
      {meetingFor && (
        <MeetingForm
          institutionId={institutionId}
          committee={meetingFor}
          onClose={() => setMeetingFor(null)}
          onDone={() => {
            setMeetingFor(null);
            setNote(t.case.saved);
          }}
        />
      )}
    </div>
  );
}

function CommitteeCases({
  institutionId,
  committee,
  onOpen,
  onMeeting,
}: {
  institutionId: string;
  committee: CommitteeRow;
  onOpen: (id: string) => void;
  onMeeting: () => void;
}) {
  const q = useQuery({
    queryKey: ['grievance-cases', committee.id],
    queryFn: () =>
      api.get<CaseRow[]>(
        `/grievances/committees/${committee.id}/cases?institutionId=${institutionId}`,
      ),
  });
  return (
    <Section
      id={`committee-${committee.id}`}
      title={committee.name}
      description={t.days(committee.decideDays)}
      flush
      actions={
        <Button size="sm" variant="secondary" onClick={onMeeting}>
          {t.case.recordMeeting}
        </Button>
      }
    >
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !q.data ? (
        <div className="p-4">
          <SkeletonRows label={committee.name} />
        </div>
      ) : q.data.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{t.noCases}</p>
      ) : (
        <CaseList rows={q.data} onOpen={onOpen} />
      )}
    </Section>
  );
}

type Step = 'note' | 'inquiry' | 'decided' | 'closed' | 'appealed';

function CaseDrawer({
  institutionId,
  caseId,
  onClose,
}: {
  institutionId: string;
  caseId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const c = t.case;
  const [step, setStep] = useState<Step | null>(null);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['grievance-case', caseId],
    queryFn: () =>
      api.get<CaseDetail>(`/grievances/cases/${caseId}?institutionId=${institutionId}`),
  });
  const go = useMutation({
    mutationFn: () =>
      step === 'note'
        ? api.post(`/grievances/cases/${caseId}/notes`, { institutionId, body: text })
        : api.post(`/grievances/cases/${caseId}/move`, {
            institutionId,
            to: step,
            ...(text.trim() ? { text } : {}),
          }),
    onSuccess: async () => {
      setStep(null);
      setText('');
      setNote(c.saved);
      for (const k of [
        'grievance-case',
        'grievance-cases',
        'grievances-mine',
        'grievance-committees',
      ])
        await qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const d = q.data;
  const title =
    step === 'note'
      ? c.addNote
      : step === 'inquiry'
        ? c.inquiry
        : step === 'decided'
          ? c.decide
          : step === 'appealed'
            ? c.appealAction
            : c.close;
  const needsText = step === 'note' || step === 'decided' || step === 'appealed';
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={d ? `#${d.number} ${d.subject}` : t.title}
      {...(d ? { subtitle: `${d.committee} · ${t.states[d.state]}` } : {})}
      closeLabel={c.close2}
    >
      <Announcer message={note} />
      {q.error ? (
        <StatePanel kind="error" title={errorText(q.error)} />
      ) : !d ? (
        <SkeletonRows label={t.title} />
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-caption text-ink-muted">
            {[
              c.raisedBy(d.raisedBy, day(d.receivedOn)),
              d.aboutStudent ? c.about(d.aboutStudent) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="text-body whitespace-pre-wrap text-ink">{d.details}</p>
          {d.outcome && (
            <section className="rounded-lg bg-paper px-4 py-3">
              <h3 className="text-caption font-semibold text-ink-muted uppercase">{c.outcome}</h3>
              <p className="text-body text-ink">{d.outcome}</p>
            </section>
          )}
          {d.appeal && (
            <section className="rounded-lg bg-paper px-4 py-3">
              <h3 className="text-caption font-semibold text-ink-muted uppercase">{c.appeal}</h3>
              <p className="text-body text-ink">{d.appeal}</p>
            </section>
          )}
          <div className="flex flex-wrap gap-2">
            {d.member && d.state !== 'closed' && (
              <Button size="sm" variant="secondary" onClick={() => setStep('note')}>
                {c.addNote}
              </Button>
            )}
            {d.member && d.state === 'received' && (
              <Button size="sm" variant="secondary" onClick={() => setStep('inquiry')}>
                {c.inquiry}
              </Button>
            )}
            {d.member && (d.state === 'received' || d.state === 'inquiry') && (
              <Button size="sm" onClick={() => setStep('decided')}>
                {c.decide}
              </Button>
            )}
            {d.member && (d.state === 'decided' || d.state === 'appealed') && (
              <Button size="sm" onClick={() => setStep('closed')}>
                {c.close}
              </Button>
            )}
            {d.canAppeal && (
              <Button size="sm" variant="secondary" onClick={() => setStep('appealed')}>
                {c.appealAction}
              </Button>
            )}
          </div>
          {d.member && (
            <section aria-labelledby="case-notes" className="flex flex-col gap-2">
              <h3 id="case-notes" className="font-display text-lead font-semibold text-ink">
                {c.notes}
              </h3>
              {d.notes.length === 0 ? (
                <p className="text-body text-ink-muted">{c.noNotes}</p>
              ) : (
                <ol className="flex flex-col divide-y divide-line">
                  {d.notes.map((n) => (
                    <li key={n.id} className="flex flex-col gap-0.5 py-2">
                      <span className="text-body text-ink">{n.body}</span>
                      <span className="text-caption text-ink-muted">
                        {n.by} · {day(n.at)}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </div>
      )}
      {step && (
        <FormModal
          title={title}
          {...(step === 'appealed' ? { description: c.appealHint } : {})}
          submitLabel={title}
          cancelLabel={c.close2}
          pending={go.isPending}
          submitDisabled={needsText && text.trim().length < (step === 'appealed' ? 10 : 3)}
          error={go.error ? errorText(go.error) : null}
          size="md"
          onClose={() => setStep(null)}
          onSubmit={() => go.mutate()}
        >
          {step !== 'inquiry' && (
            <ModalField
              label={
                step === 'note'
                  ? c.note
                  : step === 'closed'
                    ? c.closeLabel
                    : step === 'appealed'
                      ? c.appeal
                      : c.outcomeLabel
              }
              wide
            >
              <textarea
                className={cx(fieldInput, 'h-auto py-2')}
                rows={4}
                maxLength={4000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </ModalField>
          )}
        </FormModal>
      )}
    </RecordDrawer>
  );
}

function RaiseForm({
  institutionId,
  committees,
  onClose,
  onDone,
}: {
  institutionId: string;
  committees: CommitteeRow[];
  onClose: () => void;
  onDone: (number: number) => void;
}) {
  const qc = useQueryClient();
  const [committeeId, setCommitteeId] = useState(committees[0]?.id ?? '');
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: number }>('/grievances/cases', {
        institutionId,
        committeeId,
        subject,
        details,
        anonymous,
      }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ['grievances-mine'] });
      onDone(r.number);
    },
  });
  return (
    <FormModal
      title={t.raiseTitle}
      submitLabel={t.raise}
      cancelLabel={t.case.close2}
      pending={save.isPending}
      submitDisabled={!committeeId || subject.trim().length < 3 || details.trim().length < 10}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {committees.length === 0 ? (
        <p className="text-body text-ink-muted sm:col-span-2">{t.noCommittees}</p>
      ) : (
        <>
          <ModalField label={t.committee} wide>
            <select
              className={fieldInput}
              value={committeeId}
              onChange={(e) => setCommitteeId(e.target.value)}
            >
              {committees.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label={t.subject} wide>
            <input
              className={fieldInput}
              value={subject}
              maxLength={160}
              onChange={(e) => setSubject(e.target.value)}
            />
          </ModalField>
          <ModalField label={t.details} hint={t.detailsHint} wide>
            <textarea
              className={cx(fieldInput, 'h-auto py-2')}
              rows={6}
              maxLength={8000}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
            />
          </ModalField>
          <label className="flex items-start gap-2 sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1 size-4 accent-navy-950"
              checked={anonymous}
              onChange={(e) => setAnonymous(e.target.checked)}
            />
            <span className="flex flex-col">
              <span className="text-body text-ink">{t.anonymous}</span>
              <span className="text-caption text-ink-muted">{t.anonymousHint}</span>
            </span>
          </label>
        </>
      )}
    </FormModal>
  );
}

function MeetingForm({
  institutionId,
  committee,
  onClose,
  onDone,
}: {
  institutionId: string;
  committee: CommitteeRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const c = t.case;
  const [heldOn, setHeldOn] = useState('');
  const [minutes, setMinutes] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/grievances/committees/${committee.id}/meetings`, {
        institutionId,
        heldOn,
        minutes,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={`${c.recordMeeting}: ${committee.name}`}
      submitLabel={c.recordMeeting}
      cancelLabel={c.close2}
      pending={save.isPending}
      submitDisabled={!heldOn || minutes.trim().length < 3}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={c.heldOn}>
        <input
          className={fieldInput}
          type="date"
          value={heldOn}
          onChange={(e) => setHeldOn(e.target.value)}
        />
      </ModalField>
      <ModalField label={c.minutes} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={5}
          maxLength={8000}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Setup (leaders)
// ---------------------------------------------------------------------------------------------

function Setup({ institutionId }: { institutionId: string }) {
  const s = t.setup;
  const qc = useQueryClient();
  const list = useCommittees(institutionId);
  const [editing, setEditing] = useState<CommitteeRow | 'new' | null>(null);
  const [members, setMembers] = useState<CommitteeRow | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const refresh = async (msg: string) => {
    setNote(msg);
    await qc.invalidateQueries({ queryKey: ['grievance-committees'] });
  };
  if (list.error) return <StatePanel kind="error" title={errorText(list.error)} />;
  if (!list.data) return <SkeletonRows label={t.tabs.setup} />;
  return (
    <>
      <Announcer message={note} />
      {list.data.length === 0 ? (
        <EmptyState
          icon={Users}
          area="navy"
          title={s.none}
          body={s.noneBody}
          actions={
            <Button onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {s.add}
            </Button>
          }
        />
      ) : (
        <Section
          id="grievance-setup"
          title={t.tabs.setup}
          flush
          actions={
            <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {s.add}
            </Button>
          }
        >
          <ul className="divide-y divide-line">
            {list.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{c.name}</span>
                  <span className="text-caption text-ink-muted">
                    {[
                      t.kinds[c.kind],
                      t.days(c.decideDays),
                      c.members.map((m) => m.name).join(', ') || null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {!c.active && <Pill>{en.health.stock.inactive}</Pill>}
                  <Pill tone={c.overdue > 0 ? 'stop' : 'neutral'}>{t.counts(c.open, c.total)}</Pill>
                  <Button size="sm" variant="quiet" onClick={() => setMembers(c)}>
                    {s.editMembers}
                    <span className="sr-only"> {c.name}</span>
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setEditing(c)}>
                    {s.edit}
                    <span className="sr-only"> {c.name}</span>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {editing && (
        <CommitteeForm
          institutionId={institutionId}
          committee={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={async () => {
            setEditing(null);
            await refresh(s.saved);
          }}
        />
      )}
      {members && (
        <MembersForm
          institutionId={institutionId}
          committee={members}
          onClose={() => setMembers(null)}
          onDone={async () => {
            setMembers(null);
            await refresh(s.membersSaved);
          }}
        />
      )}
    </>
  );
}

function CommitteeForm({
  institutionId,
  committee,
  onClose,
  onDone,
}: {
  institutionId: string;
  committee: CommitteeRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const s = t.setup;
  const [kind, setKind] = useState<CommitteeKind>(committee?.kind ?? 'internal_complaints');
  const [name, setName] = useState(committee?.name ?? t.kinds.internal_complaints ?? '');
  const [days, setDays] = useState(committee ? String(committee.decideDays) : '');
  const [active, setActive] = useState(committee?.active ?? true);
  const body = () => ({
    institutionId,
    kind,
    name,
    active,
    ...(days ? { decideDays: Number(days) } : {}),
  });
  const save = useMutation({
    mutationFn: () =>
      committee
        ? api.put(`/grievances/committees/${committee.id}`, body())
        : api.post('/grievances/committees', body()),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={committee ? s.edit : s.add}
      submitLabel={s.save}
      cancelLabel={t.case.close2}
      pending={save.isPending}
      submitDisabled={name.trim().length < 3}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={s.kind}>
        <select
          className={fieldInput}
          value={kind}
          onChange={(e) => {
            const k = e.target.value as CommitteeKind;
            if (!committee && name === (t.kinds[kind] ?? '')) setName(t.kinds[k] ?? '');
            setKind(k);
          }}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={s.days} hint={s.daysHint}>
        <input
          className={cx(fieldInput, 'tabular')}
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </ModalField>
      <ModalField label={s.name} wide>
        <input
          className={fieldInput}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      {committee && (
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4 accent-navy-950"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span className="text-body text-ink">{s.active}</span>
        </label>
      )}
    </FormModal>
  );
}

type Draft = {
  personId?: string;
  outsideName?: string;
  role: 'chair' | 'member' | 'outside_member';
};

function MembersForm({
  institutionId,
  committee,
  onClose,
  onDone,
}: {
  institutionId: string;
  committee: CommitteeRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const s = t.setup;
  const staff = useQuery({
    queryKey: ['grievance-staff', institutionId],
    queryFn: () =>
      api.get<{ personId: string; name: string }[]>(`/people/staff?institutionId=${institutionId}`),
  });
  const [rows, setRows] = useState<Draft[]>(
    committee.members.map((m) =>
      m.personId
        ? { personId: m.personId, role: m.role as Draft['role'] }
        : { outsideName: m.name, role: 'outside_member' },
    ),
  );
  const save = useMutation({
    mutationFn: () =>
      api.put(`/grievances/committees/${committee.id}/members`, {
        institutionId,
        members: rows
          .filter((r) => r.personId || r.outsideName?.trim())
          .map((r) =>
            r.role === 'outside_member'
              ? { outsideName: r.outsideName, role: r.role }
              : { personId: r.personId, role: r.role },
          ),
      }),
    onSuccess: onDone,
  });
  const set = (i: number, patch: Partial<Draft>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <FormModal
      title={`${s.members}: ${committee.name}`}
      submitLabel={s.saveMembers}
      cancelLabel={t.case.close2}
      pending={save.isPending}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ul className="flex flex-col gap-3 sm:col-span-2">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-end gap-3">
            {r.role === 'outside_member' ? (
              <label className="flex min-w-56 flex-1 flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{s.outsideName}</span>
                <input
                  className={fieldInput}
                  value={r.outsideName ?? ''}
                  maxLength={120}
                  onChange={(e) => set(i, { outsideName: e.target.value })}
                />
              </label>
            ) : (
              <label className="flex min-w-56 flex-1 flex-col gap-1.5">
                <span className="text-caption font-medium text-ink">{s.pickStaff}</span>
                <select
                  className={fieldInput}
                  value={r.personId ?? ''}
                  onChange={(e) => set(i, { personId: e.target.value })}
                >
                  <option value="">{s.pickStaff}</option>
                  {(staff.data ?? []).map((p) => (
                    <option key={p.personId} value={p.personId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {r.role !== 'outside_member' && (
              <label className="flex flex-col gap-1.5">
                <span className="sr-only">{s.kind}</span>
                <select
                  className={fieldInput}
                  aria-label={`${s.chair} / ${s.memberRole}`}
                  value={r.role}
                  onChange={(e) => set(i, { role: e.target.value as Draft['role'] })}
                >
                  <option value="chair">{s.chair}</option>
                  <option value="member">{s.memberRole}</option>
                </select>
              </label>
            )}
            <Button
              variant="quiet"
              size="sm"
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            >
              <Trash2 aria-hidden />
              {s.remove}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRows((rs) => [...rs, { role: rs.length === 0 ? 'chair' : 'member' }])}
        >
          <Plus aria-hidden />
          {s.addStaff}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRows((rs) => [...rs, { role: 'outside_member', outsideName: '' }])}
        >
          <Plus aria-hidden />
          {s.addOutside}
        </Button>
      </div>
    </FormModal>
  );
}
