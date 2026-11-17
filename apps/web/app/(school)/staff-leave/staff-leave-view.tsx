'use client';

// Staff leave (docs/specs/STAFF_LEAVE.md): one's own leave for everyone; requests, balances,
// leave types and the month's payroll inputs for those who keep or decide leave.
import type {
  LeaveRequest,
  LeaveType,
  PayrollInputs,
  TypeBalance,
} from '@campusverse/shared-staff-attendance';
import type { ApprovalState } from '@campusverse/platform-workflow';
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
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download, Plane, Plus, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { exportCsv } from '../../../lib/csv';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { ReasonDialog } from '../reason-dialog';
import { istToday } from '../staff/staff-list';
import { monthName, shiftMonth, thisMonth } from '../staff-attendance/month-calendar';
import { useUrlTab } from '../common/url-tab';

const t = en.staffLeave;
type View = 'mine' | 'requests' | 'balances' | 'types' | 'payroll';
type Mine = { year: number; balances: TypeBalance[]; requests: LeaveRequest[] };
type Requests = {
  year: number;
  requests: LeaveRequest[];
  names: Record<string, string>;
  approvals: Record<string, ApprovalState>;
};
type StaffBalances = {
  year: number;
  types: LeaveType[];
  staff: { personId: string; name: string; employeeCode: string; balances: TypeBalance[] }[];
};

const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const daysText = (n: number) => t.days(n).replace(String(n), num(n));
const dateText = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : e.code === 'over_balance' &&
          e.details &&
          typeof (e.details as { left?: unknown }).left === 'number'
        ? `${t.errors.over_balance} ${t.leftOnly(num((e.details as { left: number }).left))}.`
        : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
const stateTone = (s: LeaveRequest['state']) =>
  s === 'approved' ? 'go' : s === 'rejected' ? 'stop' : s === 'pending' ? 'warn' : 'neutral';

/** Loading, denied, offline or error for a query; null when it has data. */
function QueryState({ q }: { q: { isPending: boolean; isError: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (!q.isError) return null;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

export function StaffLeaveView() {
  const school = useInstitution();
  const { can } = useMe();
  const [view, setView] = useUrlTab<View>(
    ['mine', 'requests', 'balances', 'types', 'payroll'],
    'mine',
  );
  const manage = can('staff.leave.manage');
  const decide = can('staff.leave.approve');
  const id = school.institutionId;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Plane}
        art="attendance"
        area="sky"
        eyebrow={en.nav.groups.people}
        title={t.title}
        description={t.lead}
        actions={
          manage || decide ? (
            <Segmented
              label={t.tabsLabel}
              value={view}
              onChange={setView}
              options={[
                { value: 'mine' as const, label: t.tabs.mine },
                { value: 'requests' as const, label: t.tabs.requests },
                ...(manage
                  ? [
                      { value: 'balances' as const, label: t.tabs.balances },
                      { value: 'types' as const, label: t.tabs.types },
                      { value: 'payroll' as const, label: t.tabs.payroll },
                    ]
                  : []),
              ]}
            />
          ) : null
        }
      />
      {!id ? (
        <SkeletonRows rows={5} label={en.states.loading.title} />
      ) : view === 'mine' ? (
        <MyLeave institutionId={id} manage={manage} />
      ) : view === 'requests' ? (
        <RequestsView institutionId={id} manage={manage} />
      ) : view === 'balances' ? (
        <BalancesView institutionId={id} />
      ) : view === 'types' ? (
        <TypesView institutionId={id} />
      ) : (
        <PayrollView institutionId={id} />
      )}
    </div>
  );
}

function RequestRow({
  r,
  names,
  actions,
  showName,
  approval,
}: {
  r: LeaveRequest;
  names?: Record<string, string>;
  actions?: ReactNode;
  showName?: boolean;
  approval?: ApprovalState | undefined;
}) {
  const by = r.requestedBy !== r.personId && names?.[r.requestedBy];
  const decider = r.decidedBy && names?.[r.decidedBy];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-body font-medium text-ink">
          {showName ? `${r.name} · ` : ''}
          {r.typeCode} · {t.range(dateText(r.from), dateText(r.to))}
          {r.halfDay ? ` · ${t.halfDay}` : ''}
        </span>
        <span className="text-caption text-ink-muted">
          <span className="tabular-nums">{daysText(r.days)}</span> · {r.reason}
          {by ? ` · ${t.askedBy(by)}` : ''}
          {decider ? ` · ${t.decidedBy(decider)}` : ''}
          {r.note ? ` · ${r.note}` : ''}
        </span>
        {approval?.status === 'pending' && (
          <span className="text-caption text-ink-muted">
            {en.workflow.progress(
              approval.step,
              approval.steps,
              approval.stepRoleName ?? en.workflow.anyApprover,
            )}
          </span>
        )}
      </div>
      <Pill tone={stateTone(r.state)}>{t.states[r.state]}</Pill>
      {actions}
    </li>
  );
}

const cancellable = (r: LeaveRequest) =>
  r.state === 'pending' || (r.state === 'approved' && r.from > istToday());

function MyLeave({ institutionId, manage }: { institutionId: string; manage: boolean }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const mine = useQuery({
    queryKey: ['leave-mine', institutionId],
    queryFn: () => api.get<Mine>(`/staff-leave/me?institutionId=${institutionId}`),
  });
  const types = useQuery({
    queryKey: ['leave-types', institutionId],
    queryFn: () => api.get<LeaveType[]>(`/staff-leave/types?institutionId=${institutionId}`),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/staff-leave/requests/${id}/cancel`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['leave-mine'] }),
  });
  if (!mine.data || !types.data) return <QueryState q={mine.isError ? mine : types} />;
  const byId = new Map(types.data.map((x) => [x.id, x]));
  const shown = mine.data.balances.filter((b) => byId.get(b.typeId)?.active);
  return (
    <>
      <KeyFigures
        label={t.yourBalances(mine.data.year, mine.data.year + 1)}
        figures={shown.map((b) => ({
          label: byId.get(b.typeId)?.name ?? '',
          value: b.left === null ? t.unlimited : num(b.left),
          note:
            b.allowance === null
              ? daysText(b.approved)
              : b.pending > 0
                ? t.pendingDays(num(b.pending))
                : t.leftOf(num(b.left ?? 0), num(b.allowance + b.carried + b.adjusted)),
          tone: b.left !== null && b.left <= 0 ? 'warn' : 'neutral',
        }))}
      />
      <Section
        title={t.yourRequests}
        flush
        actions={
          <Button onClick={() => setAsking(true)}>
            <Plus aria-hidden className="size-4" />
            {t.ask}
          </Button>
        }
      >
        {mine.data.requests.length === 0 ? (
          <EmptyState compact art="attendance" title={t.noRequests} />
        ) : (
          <ul className="divide-y divide-line">
            {mine.data.requests.map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                actions={
                  cancellable(r) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(r.id)}
                    >
                      {t.cancelLeave}
                    </Button>
                  ) : null
                }
              />
            ))}
          </ul>
        )}
        {cancel.isError && (
          <p role="alert" className="px-5 pb-4 text-caption text-signal-stop-ink">
            {errorText(cancel.error)}
          </p>
        )}
      </Section>
      {asking && (
        <AskForm
          institutionId={institutionId}
          types={types.data.filter((x) => x.active)}
          manage={manage}
          onClose={() => setAsking(false)}
          onDone={() => {
            setAsking(false);
            void qc.invalidateQueries({ queryKey: ['leave-mine'] });
            void qc.invalidateQueries({ queryKey: ['leave-requests'] });
          }}
        />
      )}
    </>
  );
}

function AskForm({
  institutionId,
  types,
  manage,
  onClose,
  onDone,
}: {
  institutionId: string;
  types: LeaveType[];
  manage: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = istToday();
  const [personId, setPersonId] = useState('');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const type = types.find((x) => x.id === typeId);
  const canHalf = !!type?.halfDay && from === to;
  const half = canHalf && halfDay;
  const staff = useQuery({
    queryKey: ['leave-balances', institutionId, undefined],
    queryFn: () => api.get<StaffBalances>(`/staff-leave/balances?institutionId=${institutionId}`),
    enabled: manage,
  });
  const body = {
    institutionId,
    ...(personId ? { personId } : {}),
    typeId,
    from,
    to: to < from ? from : to,
    halfDay: half,
  };
  const quote = useQuery({
    queryKey: ['leave-quote', body],
    queryFn: () => api.post<{ days: number; left: number | null }>('/staff-leave/quote', body),
    enabled: !!typeId && !!from && !!to,
  });
  const save = useMutation({
    mutationFn: () => api.post('/staff-leave/requests', { ...body, reason }),
    onSuccess: onDone,
  });
  const q = quote.data;
  return (
    <FormModal
      title={t.ask}
      submitLabel={t.ask}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!typeId || !reason.trim() || q?.days === 0}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {manage && staff.data && (
        <ModalField label={t.askFor} wide>
          <select
            className={fieldInput}
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
          >
            <option value="">{t.myself}</option>
            {staff.data.staff.map((s) => (
              <option key={s.personId} value={s.personId}>
                {s.name} ({s.employeeCode})
              </option>
            ))}
          </select>
        </ModalField>
      )}
      <ModalField label={t.type} wide>
        <select className={fieldInput} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.code})
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.from}>
        <input
          type="date"
          className={fieldInput}
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            if (to < e.target.value) setTo(e.target.value);
          }}
        />
      </ModalField>
      <ModalField label={t.to}>
        <input
          type="date"
          className={fieldInput}
          value={to}
          min={from}
          onChange={(e) => setTo(e.target.value)}
        />
      </ModalField>
      {canHalf && (
        <label className="col-span-full flex items-center gap-2 text-body text-ink">
          <input type="checkbox" checked={halfDay} onChange={(e) => setHalfDay(e.target.checked)} />
          {t.halfDay}
        </label>
      )}
      <ModalField label={t.reason} hint={t.reasonHint} wide>
        <textarea
          className={fieldInput}
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </ModalField>
      <p aria-live="polite" className="col-span-full text-caption text-ink-muted tabular-nums">
        {q
          ? q.days === 0
            ? t.errors.no_working_days
            : [
                t.counts(daysText(q.days)),
                q.left === null ? t.unlimited : t.leftAfter(num(q.left - q.days)),
              ].join(' · ')
          : quote.isError
            ? errorText(quote.error)
            : ' '}
      </p>
    </FormModal>
  );
}

function RequestsView({ institutionId, manage }: { institutionId: string; manage: boolean }) {
  const qc = useQueryClient();
  const [rejecting, setRejecting] = useState<LeaveRequest | null>(null);
  const list = useQuery({
    queryKey: ['leave-requests', institutionId],
    queryFn: () => api.get<Requests>(`/staff-leave/requests?institutionId=${institutionId}`),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['leave-requests'] });
    void qc.invalidateQueries({ queryKey: ['leave-mine'] });
  };
  const act = useMutation({
    mutationFn: (a: { id: string; kind: 'approve' | 'cancel' }) =>
      a.kind === 'approve'
        ? api.post(`/staff-leave/requests/${a.id}/decide`, { approve: true })
        : api.post(`/staff-leave/requests/${a.id}/cancel`, {}),
    onSuccess: refresh,
  });
  if (!list.data) return <QueryState q={list} />;
  const waiting = list.data.requests.filter((r) => r.state === 'pending');
  const rest = list.data.requests.filter((r) => r.state !== 'pending');
  return (
    <>
      <Section title={t.waiting} flush>
        {waiting.length === 0 ? (
          <EmptyState compact art="attendance" title={t.noWaiting} />
        ) : (
          <ul className="divide-y divide-line">
            {waiting.map((r) => (
              <RequestRow
                key={r.id}
                r={r}
                names={list.data.names}
                showName
                approval={list.data.approvals[r.id]}
                actions={
                  <span className="flex gap-2">
                    {manage && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: r.id, kind: 'cancel' })}
                      >
                        {t.cancelLeave}
                      </Button>
                    )}
                    {list.data.approvals[r.id]?.mine && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setRejecting(r)}>
                          {t.reject}
                        </Button>
                        <Button
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: r.id, kind: 'approve' })}
                        >
                          {t.approve}
                        </Button>
                      </>
                    )}
                  </span>
                }
              />
            ))}
          </ul>
        )}
        {act.isError && (
          <p role="alert" className="px-5 pb-4 text-caption text-signal-stop-ink">
            {errorText(act.error)}
          </p>
        )}
      </Section>
      {rest.length > 0 && (
        <Section title={t.decided} flush>
          <ul className="divide-y divide-line">
            {rest.map((r) => (
              <RequestRow key={r.id} r={r} names={list.data.names} showName />
            ))}
          </ul>
        </Section>
      )}
      {rejecting && (
        <ReasonDialog
          title={t.rejectTitle}
          hint={t.rejectHint}
          label={t.rejectNote}
          action={t.reject}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setRejecting(null)}
          submit={async (note) => {
            await api.post(`/staff-leave/requests/${rejecting.id}/decide`, {
              approve: false,
              note,
            });
            setRejecting(null);
            refresh();
          }}
        />
      )}
    </>
  );
}

function BalancesView({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const [adjusting, setAdjusting] = useState<StaffBalances['staff'][number] | null>(null);
  const b = useQuery({
    queryKey: ['leave-balances', institutionId, undefined],
    queryFn: () => api.get<StaffBalances>(`/staff-leave/balances?institutionId=${institutionId}`),
  });
  if (!b.data) return <QueryState q={b} />;
  const types = b.data.types.filter((x) => x.active);
  return (
    <Section title={t.balancesTitle(b.data.year, b.data.year + 1)} flush>
      {b.data.staff.length === 0 ? (
        <EmptyState compact art="students" title={t.noStaff} />
      ) : (
        <div role="region" aria-label={t.tabs.balances} tabIndex={0} className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line text-left text-caption text-ink-muted">
                <th scope="col" className="px-5 py-2 font-medium">
                  {t.staff}
                </th>
                {types.map((x) => (
                  <th key={x.id} scope="col" className="px-3 py-2 text-right font-medium">
                    {x.code}
                  </th>
                ))}
                <th scope="col" className="px-5 py-2">
                  <span className="sr-only">{t.adjust}</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {b.data.staff.map((s) => (
                <tr key={s.personId}>
                  <th scope="row" className="px-5 py-2 text-left font-medium text-ink">
                    {s.name}
                    <span className="block text-caption font-normal text-ink-muted">
                      {s.employeeCode}
                    </span>
                  </th>
                  {types.map((x) => {
                    const v = s.balances.find((y) => y.typeId === x.id);
                    return (
                      <td key={x.id} className="px-3 py-2 text-right tabular-nums">
                        {v?.left === null || v === undefined ? '—' : num(v.left)}
                      </td>
                    );
                  })}
                  <td className="px-5 py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => setAdjusting(s)}>
                      {t.adjust}
                      <span className="sr-only"> {s.name}</span>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adjusting && (
        <AdjustForm
          institutionId={institutionId}
          year={b.data.year}
          person={adjusting}
          types={types}
          onClose={() => setAdjusting(null)}
          onDone={() => {
            setAdjusting(null);
            void qc.invalidateQueries({ queryKey: ['leave-balances'] });
            void qc.invalidateQueries({ queryKey: ['leave-mine'] });
          }}
        />
      )}
    </Section>
  );
}

function AdjustForm({
  institutionId,
  year,
  person,
  types,
  onClose,
  onDone,
}: {
  institutionId: string;
  year: number;
  person: { personId: string; name: string };
  types: LeaveType[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('');
  const n = Number(days);
  const valid = days.trim() !== '' && n !== 0 && Number.isInteger(n * 2) && Math.abs(n) <= 366;
  const save = useMutation({
    mutationFn: () =>
      api.post('/staff-leave/adjustments', {
        institutionId,
        personId: person.personId,
        typeId,
        year,
        days: n,
        reason,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.adjustTitle(person.name)}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!valid || !reason.trim() || !typeId}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.type}>
        <select className={fieldInput} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types
            .filter((x) => x.daysPerYear !== null)
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.code})
              </option>
            ))}
        </select>
      </ModalField>
      <ModalField label={t.adjustDays} hint={t.adjustDaysHint}>
        <input
          className={fieldInput}
          inputMode="decimal"
          value={days}
          onChange={(e) => setDays(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.adjustReason} hint={t.adjustReasonHint} wide>
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

function TypesView({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<LeaveType | 'new' | null>(null);
  const types = useQuery({
    queryKey: ['leave-types', institutionId],
    queryFn: () => api.get<LeaveType[]>(`/staff-leave/types?institutionId=${institutionId}`),
  });
  if (!types.data) return <QueryState q={types} />;
  return (
    <Section
      title={t.tabs.types}
      flush
      actions={
        <Button onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" />
          {t.newType}
        </Button>
      }
    >
      <ul className="divide-y divide-line">
        {types.data.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-body font-medium text-ink">
                {x.name} ({x.code})
              </span>
              <span className="text-caption text-ink-muted tabular-nums">
                {[
                  x.paid ? t.paid : t.unpaid,
                  x.daysPerYear === null
                    ? t.unlimited
                    : `${num(x.daysPerYear)} ${t.perYear.toLowerCase()}`,
                  x.carryForwardMax > 0 ? `${t.carry}: ${num(x.carryForwardMax)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            {!x.active && <Pill>{t.retired}</Pill>}
            <Button size="sm" variant="secondary" onClick={() => setEditing(x)}>
              {t.edit}
              <span className="sr-only"> {x.name}</span>
            </Button>
          </li>
        ))}
      </ul>
      {editing && (
        <TypeForm
          type={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ['leave-types'] });
          }}
        />
      )}
    </Section>
  );
}

function TypeForm({
  type,
  onClose,
  onDone,
}: {
  type?: LeaveType | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [code, setCode] = useState(type?.code ?? '');
  const [name, setName] = useState(type?.name ?? '');
  const [paid, setPaid] = useState(type?.paid ?? true);
  const [perYear, setPerYear] = useState(
    type ? (type.daysPerYear === null ? '' : String(type.daysPerYear)) : '12',
  );
  const [carry, setCarry] = useState(String(type?.carryForwardMax ?? 0));
  const [halfDay, setHalfDay] = useState(type?.halfDay ?? true);
  const [active, setActive] = useState(type?.active ?? true);
  const half = (v: string) => v.trim() !== '' && Number.isInteger(Number(v) * 2) && Number(v) >= 0;
  const valid =
    /^[A-Z0-9]{1,6}$/.test(code) &&
    name.trim() !== '' &&
    (perYear === '' || half(perYear)) &&
    half(carry);
  const body = {
    code,
    name,
    paid,
    daysPerYear: perYear === '' ? null : Number(perYear),
    carryForwardMax: Number(carry),
    halfDay,
    active,
  };
  const save = useMutation({
    mutationFn: () =>
      type ? api.put(`/staff-leave/types/${type.id}`, body) : api.post('/staff-leave/types', body),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={type ? t.editType(type.name) : t.newType}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!valid}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.code} hint={t.codeHint}>
        <input
          className={fieldInput}
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
      </ModalField>
      <ModalField label={t.name}>
        <input
          className={fieldInput}
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.perYear} hint={t.perYearHint}>
        <input
          className={fieldInput}
          inputMode="decimal"
          value={perYear}
          onChange={(e) => setPerYear(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.carry}>
        <input
          className={fieldInput}
          inputMode="decimal"
          value={carry}
          onChange={(e) => setCarry(e.target.value)}
        />
      </ModalField>
      <div className="col-span-full flex flex-wrap gap-x-6 gap-y-2">
        {(
          [
            [t.paid, paid, setPaid],
            [t.halfDays, halfDay, setHalfDay],
            [t.active, active, setActive],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label} className="flex items-center gap-2 text-body text-ink">
            <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} />
            {label}
          </label>
        ))}
      </div>
    </FormModal>
  );
}

const PAYROLL_COLUMNS = [
  'workingDays',
  'present',
  'onDuty',
  'halfDays',
  'paidLeave',
  'unpaidLeave',
  'absent',
  'notMarked',
  'lossOfPay',
  'paidDays',
] as const;

function PayrollView({ institutionId }: { institutionId: string }) {
  const [month, setMonth] = useState(shiftMonth(thisMonth(), -1));
  const p = useQuery({
    queryKey: ['leave-payroll', institutionId, month],
    queryFn: () =>
      api.get<PayrollInputs>(`/staff-leave/payroll?institutionId=${institutionId}&month=${month}`),
  });
  const notMarked = p.data?.staff.reduce((n, s) => n + s.row.notMarked, 0) ?? 0;
  const download = () => {
    if (!p.data) return;
    void exportCsv(
      'staff_payroll',
      institutionId,
      `payroll-inputs-${month}`,
      [t.columns.code, t.columns.name, ...PAYROLL_COLUMNS.map((c) => t.columns[c])],
      p.data.staff.map((s) => [s.employeeCode, s.name, ...PAYROLL_COLUMNS.map((c) => s.row[c])]),
    );
  };
  return (
    <Section
      title={t.payrollTitle(monthName(month))}
      description={t.payrollLead}
      flush
      actions={
        <span className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t.previous}
            onClick={() => setMonth(shiftMonth(month, -1))}
            className="flex size-9 items-center justify-center rounded-lg hover:bg-paper"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label={t.next}
            disabled={month >= thisMonth()}
            onClick={() => setMonth(shiftMonth(month, 1))}
            className="flex size-9 items-center justify-center rounded-lg hover:bg-paper disabled:opacity-30"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
          <Button variant="secondary" onClick={download} disabled={!p.data}>
            <Download aria-hidden className="size-4" />
            {t.download}
          </Button>
        </span>
      }
    >
      {!p.data ? (
        <div className="p-5">
          <QueryState q={p} />
        </div>
      ) : p.data.staff.length === 0 ? (
        <EmptyState compact art="students" title={t.noStaff} />
      ) : (
        <>
          {notMarked > 0 && (
            <p className="mx-5 mb-3 flex items-start gap-2 rounded-lg bg-signal-warn-tint px-3 py-2 text-caption text-signal-warn-ink">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t.notMarkedWarning(notMarked)}
            </p>
          )}
          <div role="region" aria-label={t.tabs.payroll} tabIndex={0} className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-line text-left text-caption text-ink-muted">
                  <th scope="col" className="px-5 py-2 font-medium">
                    {t.staff}
                  </th>
                  {PAYROLL_COLUMNS.map((c) => (
                    <th key={c} scope="col" className="px-3 py-2 text-right font-medium">
                      {t.columns[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {p.data.staff.map((s) => (
                  <tr key={s.personId}>
                    <th scope="row" className="px-5 py-2 text-left font-medium text-ink">
                      {s.name}
                      <span className="block text-caption font-normal text-ink-muted">
                        {s.employeeCode}
                      </span>
                    </th>
                    {PAYROLL_COLUMNS.map((c) => (
                      <td
                        key={c}
                        className={`px-3 py-2 text-right tabular-nums ${c === 'lossOfPay' || c === 'paidDays' ? 'font-semibold text-ink' : ''}`}
                      >
                        {num(s.row[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
