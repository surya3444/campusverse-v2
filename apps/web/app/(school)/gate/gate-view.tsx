'use client';

// Visitors and gate (docs/specs/VISITORS_GATE.md): who is inside, who is expected, check in and
// out, early-leave passes, the day's history, barred visitors, and the visitors a staff member
// expects. Built to work on a phone at the gate.
import type { BarredRow, GateFigures, PassRow, VisitRow } from '@campusverse/shared-gate';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DoorOpen, Plus, LogIn, Users, Clock, LogOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { ReasonDialog } from '../reason-dialog';

const t = en.gate;
type View = 'gate' | 'passes' | 'history' | 'barred' | 'expected';
type Today = {
  today: string;
  figures: GateFigures;
  inside: VisitRow[];
  expected: VisitRow[];
  passes: PassRow[];
};
type Person = { personId: string; name: string; label: string | null };
const PURPOSES = Object.keys(t.purposes);

const time = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
const dayOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d.slice(0, 10)}T00:00:00Z`),
  );
/** What a guard types, as the API reads it; null until it's 10 digits. */
const mobile = (text: string) => {
  const d = text.replace(/[\s()-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : null;
};
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

function QueryState({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['gate-today', 'gate-history', 'gate-barred', 'gate-mine'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

export function GateView() {
  const school = useInstitution();
  const { can } = useMe();
  const read = can('gate.visitor.read');
  const expect = can('gate.visit.expect');
  const [view, setView] = useState<View>('gate');
  const id = school.institutionId;
  const today = useQuery({
    queryKey: ['gate-today', id],
    queryFn: () => api.get<Today>(`/gate/today?institutionId=${id}`),
    enabled: !!id && read,
    refetchInterval: 30_000,
  });
  const views: { value: View; label: string }[] = [
    ...(read
      ? [
          { value: 'gate' as const, label: t.tabs.gate },
          { value: 'passes' as const, label: t.tabs.passes },
          { value: 'history' as const, label: t.tabs.history },
          { value: 'barred' as const, label: t.tabs.barred },
        ]
      : []),
    ...(expect ? [{ value: 'expected' as const, label: t.tabs.expected }] : []),
  ];
  const current: View = views.some((v) => v.value === view) ? view : (views[0]?.value ?? 'gate');
  const f = today.data?.figures;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={DoorOpen}
        art="attendance"
        area="amber"
        eyebrow={en.nav.groups.services}
        title={t.title}
        description={t.lead}
        actions={
          views.length > 1 ? (
            <Segmented label={t.tabsLabel} value={current} onChange={setView} options={views} />
          ) : undefined
        }
      />
      {f && (
        <KeyFigures
          label={t.figures}
          figures={[
            {
              label: t.fig.inside,
              icon: LogIn,
              value: String(f.insideNow),
              note: t.peopleInside(f.peopleInside),
            },
            { label: t.fig.visitors, icon: Users, value: String(f.visitorsToday) },
            { label: t.fig.expected, icon: Clock, value: String(f.expectedToday) },
            { label: t.fig.passes, icon: LogOut, value: String(f.passesToday) },
          ]}
        />
      )}
      {!id ? (
        <QueryState q={school.isError ? school : { isPending: true, error: null }} />
      ) : views.length === 0 ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
      ) : current === 'expected' ? (
        <Expected institutionId={id} />
      ) : !today.data ? (
        <QueryState q={today} />
      ) : current === 'gate' ? (
        <Gate institutionId={id} day={today.data} manage={can('gate.visitor.manage')} />
      ) : current === 'passes' ? (
        <Passes
          institutionId={id}
          passes={today.data.passes}
          manage={can('gate.visitor.manage')}
          issue={can('gate.pass.issue')}
        />
      ) : current === 'history' ? (
        <History institutionId={id} today={today.data.today} />
      ) : (
        <Barred institutionId={id} bar={can('gate.visitor.bar')} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The gate: inside now and expected today
// ---------------------------------------------------------------------------------------------

function VisitLine({ v, today }: { v: VisitRow; today?: string }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex flex-wrap items-center gap-2 text-body text-ink">
        {v.name}
        {v.barred && <Pill tone="stop">{t.tabs.barred}</Pill>}
      </span>
      <span className="text-caption text-ink-muted tabular-nums">
        {[
          t.purposes[v.purpose],
          v.host ? t.meets(v.host) : null,
          t.people(v.partySize),
          v.vehicleNo || null,
          v.badgeNo ? `${t.badge} ${v.badgeNo}` : null,
          v.inAt && v.state === 'in'
            ? today && dayOf(v.inAt) < today
              ? t.sinceYesterday(time(v.inAt))
              : t.since(time(v.inAt))
            : null,
          v.state === 'expected' && v.expectedBy ? t.expectedBy(v.expectedBy) : null,
          v.note || null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </span>
  );
}

function Gate({
  institutionId,
  day,
  manage,
}: {
  institutionId: string;
  day: Today;
  manage: boolean;
}) {
  const refresh = useRefresh();
  const [checking, setChecking] = useState<VisitRow | 'walk-in' | null>(null);
  const out = useMutation({
    mutationFn: (visitId: string) => api.post(`/gate/visits/${visitId}/out`, { institutionId }),
    onSuccess: refresh,
  });
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
      <Section
        id="gate-inside"
        title={t.inside}
        flush
        actions={
          manage ? (
            <Button size="sm" onClick={() => setChecking('walk-in')}>
              <Plus aria-hidden className="size-4" />
              {t.checkIn}
            </Button>
          ) : undefined
        }
      >
        {out.isError && (
          <p role="alert" className="px-5 pt-3 text-caption text-signal-stop-ink">
            {errorText(out.error)}
          </p>
        )}
        {day.inside.length === 0 ? (
          <EmptyState compact icon={DoorOpen} title={t.nobodyInside} body={t.nobodyInsideBody} />
        ) : (
          <ul className="divide-y divide-line">
            {day.inside.map((v) => (
              <li key={v.visitId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <VisitLine v={v} today={day.today} />
                {manage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={out.isPending}
                    onClick={() => out.mutate(v.visitId)}
                  >
                    {t.checkOut}
                    <span className="sr-only"> {v.name}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section id="gate-expected" title={t.expectedToday} flush>
        {day.expected.length === 0 ? (
          <p className="px-5 py-4 text-body text-ink-muted">{t.nobodyExpected}</p>
        ) : (
          <ul className="divide-y divide-line">
            {day.expected.map((v) => (
              <li key={v.visitId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                <VisitLine v={v} />
                {manage && (
                  <Button size="sm" variant="secondary" onClick={() => setChecking(v)}>
                    {t.checkIn}
                    <span className="sr-only"> {v.name}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {checking && (
        <CheckInForm
          institutionId={institutionId}
          expected={checking === 'walk-in' ? null : checking}
          onClose={() => setChecking(null)}
          onDone={() => {
            setChecking(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/** Finds a staff member or a student, then shows who was picked with Change. */
function PersonPicker({
  institutionId,
  kind,
  label,
  hint,
  empty,
  value,
  onChange,
}: {
  institutionId: string;
  kind: 'staff' | 'student';
  label: string;
  hint: string;
  empty: string;
  value: Person | null;
  onChange: (p: Person | null) => void;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  const found = useQuery({
    queryKey: ['gate-people', institutionId, kind, query],
    queryFn: () =>
      api.get<Person[]>(
        `/gate/people?institutionId=${institutionId}&kind=${kind}&text=${encodeURIComponent(query)}`,
      ),
    enabled: query.length >= 2 && !value,
  });
  if (value)
    return (
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="text-caption font-medium text-ink">{label}</span>
        <span className="flex items-center gap-3 rounded-lg border border-line-strong px-3 py-2">
          <span className="min-w-0 flex-1 text-body text-ink">
            {value.name}
            {value.label && (
              <span className="block text-caption text-ink-muted">{value.label}</span>
            )}
          </span>
          <Button size="sm" variant="secondary" type="button" onClick={() => onChange(null)}>
            {t.change}
            <span className="sr-only"> {label}</span>
          </Button>
        </span>
      </div>
    );
  return (
    <>
      <ModalField label={label} hint={hint} wide>
        <input
          className={fieldInput}
          value={text}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
        />
      </ModalField>
      {query.length >= 2 && found.data && (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line sm:col-span-2">
          {found.data.length === 0 ? (
            <li className="px-3 py-2 text-body text-ink-muted">{empty}</li>
          ) : (
            found.data.map((p) => (
              <li key={p.personId}>
                <button
                  type="button"
                  onClick={() => onChange(p)}
                  className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper"
                >
                  <span className="text-body text-ink">{p.name}</span>
                  {p.label && <span className="text-caption text-ink-muted">{p.label}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </>
  );
}

function CheckInForm({
  institutionId,
  expected,
  onClose,
  onDone,
}: {
  institutionId: string;
  expected: VisitRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState(expected?.phone.replace(/^\+91/, '') ?? '');
  const [name, setName] = useState(expected?.name ?? '');
  const [purpose, setPurpose] = useState(expected?.purpose ?? 'parent_meeting');
  const [host, setHost] = useState<Person | null>(
    expected?.hostPersonId
      ? { personId: expected.hostPersonId, name: expected.host ?? '', label: null }
      : null,
  );
  const [party, setParty] = useState(String(expected?.partySize ?? 1));
  const [vehicle, setVehicle] = useState('');
  const [badge, setBadge] = useState('');
  const [note, setNote] = useState(expected?.note ?? '');
  const digits = mobile(phone);
  const known = useQuery({
    queryKey: ['gate-visitor', institutionId, digits],
    queryFn: () =>
      api.get<{
        name: string | null;
        barredReason: string | null;
        lastVisits: VisitRow[];
      }>(`/gate/visitor?institutionId=${institutionId}&phone=${digits}`),
    enabled: !!digits,
  });
  useEffect(() => {
    if (known.data?.name && !name) setName(known.data.name);
  }, [known.data, name]);
  const last = known.data?.lastVisits[0];
  const save = useMutation({
    mutationFn: () =>
      api.post('/gate/visits', {
        institutionId,
        visitId: expected?.visitId ?? null,
        phone: digits,
        name,
        purpose,
        note,
        hostPersonId: host?.personId ?? null,
        partySize: Number(party),
        vehicleNo: vehicle,
        badgeNo: badge,
      }),
    onSuccess: onDone,
  });
  const barred = known.data?.barredReason;
  return (
    <FormModal
      title={expected ? t.checkInExpected(expected.name) : t.checkInTitle}
      submitLabel={t.checkIn}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={
        !digits || !name.trim() || !!barred || !(Number(party) >= 1 && Number(party) <= 50)
      }
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField
        label={t.phone}
        hint={
          phone && !digits
            ? t.badPhone
            : last
              ? t.lastVisit(dmy(last.inAt ?? ''), t.purposes[last.purpose] ?? '')
              : t.phoneHint
        }
      >
        <input
          className={fieldInput}
          inputMode="tel"
          autoComplete="off"
          value={phone}
          readOnly={!!expected}
          onChange={(e) => setPhone(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.name}>
        <input
          className={fieldInput}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      {barred && (
        <p
          role="alert"
          className="rounded-lg bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink sm:col-span-2"
        >
          {t.barredWarning(barred)}
        </p>
      )}
      <ModalField label={t.purpose}>
        <select
          className={fieldInput}
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as VisitRow['purpose'])}
        >
          {PURPOSES.map((p) => (
            <option key={p} value={p}>
              {t.purposes[p]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.partySize}>
        <input
          className={fieldInput}
          inputMode="numeric"
          value={party}
          onChange={(e) => setParty(e.target.value)}
        />
      </ModalField>
      <PersonPicker
        institutionId={institutionId}
        kind="staff"
        label={t.host}
        hint={`${t.hostHint} ${t.staffSearchHint}`}
        empty={t.noStaff}
        value={host}
        onChange={setHost}
      />
      <ModalField label={t.vehicle} hint={t.optional}>
        <input
          className={cx(fieldInput, 'uppercase')}
          autoComplete="off"
          maxLength={20}
          value={vehicle}
          onChange={(e) => setVehicle(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.badge} hint={t.optional}>
        <input
          className={fieldInput}
          autoComplete="off"
          maxLength={20}
          value={badge}
          onChange={(e) => setBadge(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.note} hint={t.optional} wide>
        <input
          className={fieldInput}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------------------------

function PassLine({ p }: { p: PassRow }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex flex-wrap items-center gap-2 text-body text-ink">
        {p.student}
        {p.label && <span className="text-caption text-ink-muted">{p.label}</span>}
        <Pill tone={p.state === 'left' ? 'go' : p.state === 'cancelled' ? 'neutral' : 'warn'}>
          {t.passState[p.state]}
        </Pill>
        {p.state === 'issued' && p.locked && <Pill tone="stop">{t.code.locked}</Pill>}
      </span>
      <span className="text-caption text-ink-muted tabular-nums">
        {[
          t.collects(p.collector, p.relation),
          p.phone && !p.guardian ? p.phone.replace(/^\+91/, '') : null,
          p.reason,
          p.leftAt ? t.leftAt(time(p.leftAt)) : t.issuedBy(p.issuedBy ?? '', time(p.issuedAt)),
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </span>
  );
}

function Passes({
  institutionId,
  passes,
  manage,
  issue,
}: {
  institutionId: string;
  passes: PassRow[];
  manage: boolean;
  issue: boolean;
}) {
  const refresh = useRefresh();
  const [issuing, setIssuing] = useState(false);
  const [cancelling, setCancelling] = useState<PassRow | null>(null);
  const [leaving, setLeaving] = useState<PassRow | null>(null);
  const [note, setNote] = useState<{ text: string; sms: Simulated | null } | null>(null);
  const left = useMutation({
    mutationFn: (passId: string) => api.post(`/gate/passes/${passId}/left`, { institutionId }),
    onSuccess: refresh,
  });
  const resend = useMutation({
    mutationFn: (passId: string) =>
      api.post<{ simulated?: Simulated }>(`/gate/passes/${passId}/code`, { institutionId }),
    onSuccess: (r) => {
      setNote({ text: t.code.resent, sms: r.simulated ?? null });
      refresh();
    },
  });
  return (
    <Section
      id="gate-passes"
      title={t.tabs.passes}
      description={t.passesLead}
      flush
      actions={
        issue ? (
          <Button size="sm" onClick={() => setIssuing(true)}>
            <Plus aria-hidden className="size-4" />
            {t.issuePass}
          </Button>
        ) : undefined
      }
    >
      {(left.isError || resend.isError) && (
        <p role="alert" className="px-5 pt-3 text-caption text-signal-stop-ink">
          {errorText(left.error ?? resend.error)}
        </p>
      )}
      {note && (
        <div role="status" className="flex flex-col gap-2 px-5 pt-3">
          <span className="text-body text-ink">{note.text}</span>
          {note.sms && <SimulatedSms sms={note.sms} />}
        </div>
      )}
      {passes.length === 0 ? (
        <EmptyState compact icon={DoorOpen} title={t.noPasses} body={t.noPassesBody} />
      ) : (
        <ul className="divide-y divide-line">
          {passes.map((p) => (
            <li key={p.passId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <PassLine p={p} />
              {p.state === 'issued' && manage && !p.locked && (
                <Button
                  size="sm"
                  disabled={left.isPending}
                  onClick={() => (p.codeNeeded ? setLeaving(p) : left.mutate(p.passId))}
                >
                  {t.left}
                  <span className="sr-only"> {p.student}</span>
                </Button>
              )}
              {p.state === 'issued' && issue && p.codeNeeded && (
                <Button
                  size="sm"
                  variant={p.locked ? 'primary' : 'quiet'}
                  disabled={resend.isPending}
                  onClick={() => resend.mutate(p.passId)}
                >
                  {t.code.resend}
                  <span className="sr-only"> {p.student}</span>
                </Button>
              )}
              {p.state === 'issued' && issue && (
                <Button size="sm" variant="secondary" onClick={() => setCancelling(p)}>
                  {t.cancelPass}
                  <span className="sr-only"> {p.student}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {issuing && (
        <PassForm
          institutionId={institutionId}
          onClose={() => setIssuing(false)}
          onDone={(sms) => {
            setIssuing(false);
            setNote({ text: t.code.sent, sms });
            refresh();
          }}
        />
      )}
      {leaving && (
        <CodeDialog
          institutionId={institutionId}
          pass={leaving}
          onClose={() => setLeaving(null)}
          onDone={() => {
            setLeaving(null);
            refresh();
          }}
        />
      )}
      {cancelling && (
        <ReasonDialog
          title={`${t.cancelPass}: ${cancelling.student}`}
          hint={t.cancelPassHint}
          label={t.reason}
          action={t.cancelPass}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setCancelling(null)}
          submit={async (reason) => {
            await api.post(`/gate/passes/${cancelling.passId}/cancel`, { institutionId, reason });
            refresh();
          }}
        />
      )}
    </Section>
  );
}

type Simulated = { to: string; text: string };

function SimulatedSms({ sms }: { sms: Simulated }) {
  return (
    <span className="flex flex-col gap-1 rounded-md border border-signal-warn/40 bg-signal-warn-tint px-4 py-3">
      <span className="text-caption font-semibold text-signal-warn-ink">{t.code.simulated}</span>
      <span className="tabular text-body text-ink">{sms.text}</span>
      <span className="text-caption text-ink-muted">{t.code.simulatedHint}</span>
    </span>
  );
}

/** The guard types the parent's code; a wrong code is counted and says how many tries remain. */
function CodeDialog({
  institutionId,
  pass,
  onClose,
  onDone,
}: {
  institutionId: string;
  pass: PassRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const go = useMutation({
    mutationFn: () => api.post(`/gate/passes/${pass.passId}/left`, { institutionId, code }),
    onSuccess: onDone,
  });
  const e = go.error;
  const message =
    e instanceof ApiFailure && e.code === 'wrong_code'
      ? t.code.wrong(Number((e.details as { triesLeft?: number } | null)?.triesLeft ?? 0))
      : e
        ? errorText(e)
        : null;
  return (
    <FormModal
      title={t.code.askTitle(pass.student)}
      description={t.code.ask}
      submitLabel={t.code.confirm}
      cancelLabel={t.cancel}
      pending={go.isPending}
      submitDisabled={!/^\d{6}$/.test(code.replace(/\s/g, ''))}
      error={message}
      size="md"
      onClose={onClose}
      onSubmit={() => go.mutate()}
    >
      <ModalField label={t.code.label} wide>
        <input
          className={cx(fieldInput, 'tabular text-[1.25rem] tracking-[0.3em]')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(ev) => setCode(ev.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function PassForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: (sms: Simulated | null) => void;
}) {
  const [student, setStudent] = useState<Person | null>(null);
  const [who, setWho] = useState<string>('');
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const [reason, setReason] = useState('');
  const guardians = useQuery({
    queryKey: ['gate-pickup', institutionId, student?.personId],
    queryFn: () =>
      api.get<{ personId: string; name: string; relationship: string; canPickup: boolean }[]>(
        `/gate/pickup?institutionId=${institutionId}&studentId=${student?.personId}`,
      ),
    enabled: !!student,
  });
  const other = who === 'other';
  const digits = mobile(phone);
  const save = useMutation({
    mutationFn: () =>
      api.post<{ passId: string; simulated?: Simulated }>('/gate/passes', {
        institutionId,
        studentId: student?.personId,
        collector: other ? { name, relation, phone: digits } : { guardianId: who },
        reason,
      }),
    onSuccess: (r) => onDone(r.simulated ?? null),
  });
  const ready =
    !!student &&
    reason.trim().length >= 3 &&
    (other ? !!name.trim() && !!relation.trim() && !!digits : !!who);
  const options = [
    ...(guardians.data ?? []).map((g) => ({
      value: g.personId,
      label: g.name,
      hint: [t.relationOf(g.relationship), g.canPickup ? t.onPickupList : null]
        .filter(Boolean)
        .join(' · '),
    })),
    { value: 'other', label: t.someoneElse, hint: '' },
  ];
  return (
    <FormModal
      title={t.issuePassTitle}
      submitLabel={t.issuePass}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!ready}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <PersonPicker
        institutionId={institutionId}
        kind="student"
        label={t.student}
        hint={t.studentHint}
        empty={t.noStudents}
        value={student}
        onChange={(p) => {
          setStudent(p);
          setWho('');
        }}
      />
      {student && guardians.data && (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1.5 text-caption font-medium text-ink">{t.collector}</legend>
          {guardians.data.length === 0 && (
            <p className="text-caption text-signal-warn-ink">{t.noGuardians}</p>
          )}
          <div role="radiogroup" aria-label={t.collector} className="flex flex-col gap-2">
            {options.map((o) => (
              <label
                key={o.value}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2',
                  who === o.value ? 'border-navy-950 bg-navy-50' : 'border-line-strong',
                )}
              >
                <input
                  type="radio"
                  name="collector"
                  className="mt-1"
                  checked={who === o.value}
                  onChange={() => setWho(o.value)}
                />
                <span className="flex flex-col">
                  <span className="text-body text-ink">{o.label}</span>
                  {o.hint && <span className="text-caption text-ink-muted">{o.hint}</span>}
                </span>
              </label>
            ))}
          </div>
          <span className="text-caption text-ink-muted">{t.collectorHint}</span>
        </fieldset>
      )}
      {other && (
        <>
          <ModalField label={t.collectorName}>
            <input className={fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
          </ModalField>
          <ModalField label={t.relation}>
            <input
              className={fieldInput}
              value={relation}
              maxLength={50}
              onChange={(e) => setRelation(e.target.value)}
            />
          </ModalField>
          <ModalField label={t.collectorPhone} hint={phone && !digits ? t.badPhone : undefined}>
            <input
              className={fieldInput}
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </ModalField>
        </>
      )}
      <ModalField label={t.reason} hint={t.reasonHint} wide>
        <input
          className={fieldInput}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// History and barred visitors
// ---------------------------------------------------------------------------------------------

function History({ institutionId, today }: { institutionId: string; today: string }) {
  const [on, setOn] = useState(today);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  const q = useQuery({
    queryKey: ['gate-history', institutionId, on, search],
    queryFn: () =>
      api.get<{ visits: VisitRow[]; passes: PassRow[] }>(
        `/gate/history?institutionId=${institutionId}&on=${on}&search=${encodeURIComponent(search)}`,
      ),
    enabled: !!on,
  });
  return (
    <div className="flex flex-col gap-6">
      <div className="panel flex flex-wrap items-end gap-4 p-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.day}</span>
          <input
            type="date"
            className={fieldInput}
            value={on}
            max={today}
            onChange={(e) => setOn(e.target.value)}
          />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.search}</span>
          <input
            type="search"
            className={fieldInput}
            value={text}
            placeholder={t.searchHint}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      </div>
      {!q.data ? (
        <QueryState q={q} />
      ) : (
        <>
          <Section id="gate-history-visits" title={t.visitsThatDay} flush>
            {q.data.visits.length === 0 ? (
              <EmptyState compact art="search" title={t.noHistory} />
            ) : (
              <ul className="divide-y divide-line">
                {q.data.visits.map((v) => (
                  <li
                    key={v.visitId}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-body text-ink">{v.name}</span>
                      <span className="text-caption text-ink-muted tabular-nums">
                        {[
                          v.phone.replace(/^\+91/, ''),
                          t.purposes[v.purpose],
                          v.host ? t.meets(v.host) : null,
                          v.vehicleNo || null,
                          v.inAt ? t.inOut(time(v.inAt), v.outAt ? time(v.outAt) : null) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <Pill tone={v.state === 'in' ? 'warn' : 'neutral'}>
                      {t.visitState[v.state]}
                    </Pill>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {q.data.passes.length > 0 && (
            <Section id="gate-history-passes" title={t.passesThatDay} flush>
              <ul className="divide-y divide-line">
                {q.data.passes.map((p) => (
                  <li key={p.passId} className="flex px-5 py-3">
                    <PassLine p={p} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Barred({ institutionId, bar }: { institutionId: string; bar: boolean }) {
  const refresh = useRefresh();
  const [adding, setAdding] = useState(false);
  const [lifting, setLifting] = useState<BarredRow | null>(null);
  const q = useQuery({
    queryKey: ['gate-barred', institutionId],
    queryFn: () => api.get<BarredRow[]>(`/gate/barred?institutionId=${institutionId}`),
  });
  return (
    <Section
      id="gate-barred"
      title={t.tabs.barred}
      description={t.barredLead}
      flush
      actions={
        bar ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            {t.barVisitor}
          </Button>
        ) : undefined
      }
    >
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : q.data.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{t.noBarred}</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((b) => (
            <li key={b.visitorId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-ink">{b.name}</span>
                <span className="text-caption text-ink-muted tabular-nums">
                  {[
                    b.phone.replace(/^\+91/, ''),
                    b.reason,
                    t.barredBy(b.barredBy ?? '', dmy(dayOf(b.barredAt))),
                  ].join(' · ')}
                </span>
              </span>
              {bar && (
                <Button size="sm" variant="secondary" onClick={() => setLifting(b)}>
                  {t.liftBar}
                  <span className="sr-only"> {b.name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <BarForm
          institutionId={institutionId}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
      {lifting && (
        <ReasonDialog
          title={`${t.liftBar}: ${lifting.name}`}
          hint={t.liftBarHint}
          label={t.reason}
          action={t.liftBar}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setLifting(null)}
          submit={async (reason) => {
            await api.post(`/gate/barred/${lifting.visitorId}/lift`, { institutionId, reason });
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function BarForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const digits = mobile(phone);
  const save = useMutation({
    mutationFn: () => api.post('/gate/barred', { institutionId, phone: digits, name, reason }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.barVisitor}
      description={t.barredLead}
      submitLabel={t.barVisitor}
      cancelLabel={t.cancel}
      tone="danger"
      pending={save.isPending}
      submitDisabled={!digits || !name.trim() || reason.trim().length < 3}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.phone} hint={phone && !digits ? t.badPhone : undefined}>
        <input
          className={fieldInput}
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.name}>
        <input className={fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
      </ModalField>
      <ModalField label={t.reason} wide>
        <input
          className={fieldInput}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// The visitors a staff member expects
// ---------------------------------------------------------------------------------------------

function Expected({ institutionId }: { institutionId: string }) {
  const refresh = useRefresh();
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['gate-mine', institutionId],
    queryFn: () => api.get<VisitRow[]>(`/gate/expected?institutionId=${institutionId}`),
  });
  const cancel = useMutation({
    mutationFn: (visitId: string) =>
      api.post(`/gate/expected/${visitId}/cancel`, { institutionId }),
    onSuccess: refresh,
  });
  return (
    <Section
      id="gate-mine"
      title={t.tabs.expected}
      description={t.expectedLead}
      flush
      actions={
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus aria-hidden className="size-4" />
          {t.expectVisitor}
        </Button>
      }
    >
      {cancel.isError && (
        <p role="alert" className="px-5 pt-3 text-caption text-signal-stop-ink">
          {errorText(cancel.error)}
        </p>
      )}
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState compact icon={DoorOpen} title={t.noMine} body={t.noMineBody} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((v) => (
            <li key={v.visitId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body text-ink">{v.name}</span>
                <span className="text-caption text-ink-muted tabular-nums">
                  {[
                    dmy(v.expectedOn ?? ''),
                    t.purposes[v.purpose],
                    t.people(v.partySize),
                    v.inAt ? t.since(time(v.inAt)) : null,
                    v.note || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <Pill tone={v.state === 'in' ? 'go' : 'neutral'}>
                {v.state === 'expected' ? t.fig.expected : t.visitState[v.state]}
              </Pill>
              {v.state === 'expected' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(v.visitId)}
                >
                  {t.cancelExpected}
                  <span className="sr-only"> {v.name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <ExpectForm
          institutionId={institutionId}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function ExpectForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('parent_meeting');
  const [party, setParty] = useState('1');
  const [on, setOn] = useState(dayOf(new Date().toISOString()));
  const [note, setNote] = useState('');
  const digits = mobile(phone);
  const save = useMutation({
    mutationFn: () =>
      api.post('/gate/expected', {
        institutionId,
        phone: digits,
        name,
        purpose,
        note,
        partySize: Number(party),
        expectedOn: on,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.expectVisitor}
      description={t.expectedLead}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!digits || !name.trim() || !on || !(Number(party) >= 1)}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.phone} hint={phone && !digits ? t.badPhone : undefined}>
        <input
          className={fieldInput}
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.name}>
        <input className={fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
      </ModalField>
      <ModalField label={t.on}>
        <input
          type="date"
          className={fieldInput}
          value={on}
          min={dayOf(new Date().toISOString())}
          onChange={(e) => setOn(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.purpose}>
        <select className={fieldInput} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          {PURPOSES.map((p) => (
            <option key={p} value={p}>
              {t.purposes[p]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.partySize}>
        <input
          className={fieldInput}
          inputMode="numeric"
          value={party}
          onChange={(e) => setParty(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.note} hint={t.optional}>
        <input
          className={fieldInput}
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}
