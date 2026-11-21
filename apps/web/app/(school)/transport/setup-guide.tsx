'use client';

// Transport set up in one place (docs/specs/CONNECTED_SCHOOL.md): the setup guide, adding drivers
// and attendants as staff with their role, and each fare zone's fee, all on the Transport page.
import type { GroupFee, IssuePreview } from '@campusverse/shared-finance';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  PreviewCanvas,
  Section,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronRight, IndianRupee, Plus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { SCHEDULES, instalmentsFor, splitPaise, type Schedule } from '../../../lib/instalments';
import { parseRupees, rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { istToday } from '../staff/staff-list';
import { date, errorText, t, type Ctx } from './shared';

export type GuideStep = 'vehicles' | 'crew' | 'stops' | 'routes' | 'fees';
const STEPS: GuideStep[] = ['vehicles', 'crew', 'stops', 'routes', 'fees'];

/** The zone fees, read where Transport needs them (guide and Fees tab share one query). */
export function useZoneFees(ctx: Pick<Ctx, 'institutionId' | 'data'>, enabled: boolean) {
  const ids = ctx.data.zones.map((z) => z.id).join(',');
  return useQuery({
    queryKey: ['zone-fees', ctx.institutionId, ids],
    queryFn: () =>
      api
        .get<GroupFee[]>(`/transport/zone-fees?institutionId=${ctx.institutionId}&zoneIds=${ids}`)
        .catch((e: unknown) => {
          // Someone who can't read fees still sees the rest of the guide.
          if (e instanceof ApiFailure && e.status === 403) return null;
          throw e;
        }),
    enabled: enabled && ids.length > 0,
  });
}

/**
 * What's left to set up, in order, with the action for each step on this page. It disappears
 * once every step is done (or the person hides it on this device).
 */
export function SetupGuide({
  ctx,
  fees,
  onStep,
}: {
  ctx: Ctx;
  fees: GroupFee[] | null | undefined;
  onStep: (step: GuideStep) => void;
}) {
  const g = t.guide;
  const { data } = ctx;
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(`cv.transport.guide.${ctx.institutionId}`) === 'hidden';
    } catch {
      return false;
    }
  });
  const routes = data.routes.filter((r) => r.active);
  const crewed = routes.filter((r) => r.driverPersonId && r.attendantPersonId).length;
  const zonedStops = data.stops.filter((s) => s.active && s.fareZone !== null).length;
  const priced = new Set((fees ?? []).map((f) => f.groupId));
  const pricedZones = data.zones.filter((z) => priced.has(z.id)).length;
  const done: Record<GuideStep, boolean> = {
    vehicles: data.vehicles.some((v) => v.active),
    crew: routes.length > 0 && crewed === routes.length,
    stops: zonedStops > 0,
    routes: routes.some((r) => r.stops.length > 0),
    fees: data.zones.length > 0 && pricedZones === data.zones.length,
  };
  const counts: Record<GuideStep, string> = {
    vehicles: g.counts.vehicles(data.vehicles.filter((v) => v.active).length),
    crew: g.counts.crew(crewed, routes.length),
    stops: g.counts.stops(zonedStops),
    routes: g.counts.routes(routes.length),
    fees: g.counts.fees(pricedZones, data.zones.length),
  };
  const can: Record<GuideStep, boolean> = {
    vehicles: ctx.manageVehicles,
    crew: ctx.manageRoutes,
    stops: ctx.manageRoutes,
    routes: ctx.manageRoutes,
    fees: fees !== null,
  };
  const finished = STEPS.filter((s) => done[s]).length;
  if (hidden || finished === STEPS.length) return null;
  const next = STEPS.find((s) => !done[s]);
  return (
    <section aria-labelledby="transport-guide" className="panel overflow-hidden">
      <div className="flex flex-wrap items-start gap-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="transport-guide" className="font-display text-lead font-semibold text-ink">
            {g.title}
          </h2>
          <p className="max-w-2xl text-caption text-ink-muted">{g.lead}</p>
        </div>
        <span className="tabular rounded-full bg-navy-50 px-2.5 py-0.5 text-caption font-medium text-navy-700">
          {g.done(finished, STEPS.length)}
        </span>
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            setHidden(true);
            try {
              localStorage.setItem(`cv.transport.guide.${ctx.institutionId}`, 'hidden');
            } catch {
              // Storage can be blocked; it simply shows again next time.
            }
          }}
        >
          {g.hide}
        </Button>
      </div>
      <ol className="grid divide-y divide-line md:grid-cols-5 md:divide-x md:divide-y-0">
        {STEPS.map((s, i) => {
          const [title, body] = g.steps[s] ?? ['', ''];
          return (
            <li
              key={s}
              className={cx('flex flex-col gap-2 px-5 py-4', s === next && 'bg-navy-50/50')}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={cx(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold',
                    done[s]
                      ? 'bg-signal-go text-white'
                      : s === next
                        ? 'bg-navy-950 text-white'
                        : 'bg-navy-50 text-navy-700',
                  )}
                >
                  {done[s] ? <Check className="size-3.5" /> : i + 1}
                </span>
                <h3 className="text-body font-semibold text-ink">{title}</h3>
              </div>
              <p className="text-caption text-ink-muted">{body}</p>
              <p className="tabular text-caption font-medium text-ink">{counts[s]}</p>
              {can[s] && (
                <button
                  type="button"
                  onClick={() => onStep(s)}
                  className="mt-auto inline-flex w-fit items-center gap-1 rounded-md text-caption font-semibold text-navy-950 hover:underline"
                >
                  {g.actions[s]}
                  <ChevronRight aria-hidden className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type Role = { id: string; key: string };

/**
 * A driver or bus attendant, added in place: created as staff (they then appear on the staff
 * list), then given the role for this school. If the role step fails, they stay on staff and the
 * message says where to finish.
 */
export function CrewModal({
  institutionId,
  role,
  onClose,
  onDone,
}: {
  institutionId: string;
  role: 'driver' | 'attendant';
  onClose: () => void;
  onDone: (message: string, personId: string) => void;
}) {
  const c = t.crew;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [joined, setJoined] = useState(istToday());
  const roles = useQuery({
    queryKey: ['access-roles'],
    queryFn: () => api.get<{ roles: Role[] }>('/access/roles'),
  });
  const add = useMutation({
    mutationFn: async () => {
      const clean = name.trim();
      const { personId } = await api.post<{ personId: string }>('/people/staff', {
        institutionId,
        name: clean,
        phone: `+91${phone.replace(/\D/g, '').slice(-10)}`,
        designation: role === 'driver' ? 'Driver' : 'Bus attendant',
        department: 'Transport',
        employmentType: 'permanent',
        joinedOn: joined,
      });
      const key = role === 'driver' ? 'driver' : 'bus_attendant';
      const roleId = roles.data?.roles.find((r) => r.key === key)?.id;
      try {
        if (!roleId) throw new Error('no role');
        await api.post('/access/assignments', {
          personId,
          roleId,
          scope: { type: 'institution', id: institutionId },
          from: joined,
          until: null,
        });
        return { message: c.added(clean), personId };
      } catch {
        return { message: c.roleFailed(clean), personId };
      }
    },
    onSuccess: (r) => onDone(r.message, r.personId),
  });
  return (
    <FormModal
      title={c.title(role)}
      description={c.lead}
      submitLabel={c.save}
      cancelLabel={t.cancel}
      pending={add.isPending}
      submitDisabled={roles.isPending}
      error={add.error ? errorText(add.error) : null}
      onClose={onClose}
      onSubmit={() => add.mutate()}
    >
      <ModalField label={c.name}>
        <input
          required
          maxLength={120}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={c.phone}>
        <input
          required
          inputMode="numeric"
          pattern="(\+91)?[0-9 ]{10,13}"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <ModalField label={c.joined}>
        <input
          type="date"
          required
          value={joined}
          onChange={(e) => setJoined(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

/** Staff who can drive or attend, with how many routes they usually run. */
export function CrewList({
  ctx,
  canAdd,
  onAdd,
}: {
  ctx: Ctx;
  canAdd: boolean;
  onAdd: (role: 'driver' | 'attendant') => void;
}) {
  const c = t.crew;
  // The owner and office can do everything; the list is of people whose job is the bus.
  const crew = ctx.data.crew.filter(
    (m) =>
      (m.canDrive !== m.canAttend ||
        ctx.data.routes.some(
          (r) => r.driverPersonId === m.personId || r.attendantPersonId === m.personId,
        )) &&
      (m.canDrive || m.canAttend),
  );
  const routesOf = (id: string) =>
    ctx.data.routes.filter((r) => r.driverPersonId === id || r.attendantPersonId === id).length;
  return (
    <Section
      title={c.list}
      flush
      actions={
        canAdd ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => onAdd('driver')}>
              <UserPlus aria-hidden className="size-4" />
              {c.addDriver}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onAdd('attendant')}>
              <UserPlus aria-hidden className="size-4" />
              {c.addAttendant}
            </Button>
          </div>
        ) : undefined
      }
    >
      {crew.length === 0 ? (
        <EmptyState compact title={c.listEmpty} body={canAdd ? undefined : c.noRight} />
      ) : (
        <ul className="divide-y divide-line">
          {crew.map((m) => (
            <li key={m.personId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <a
                href={`/staff/${m.personId}`}
                className="text-body font-medium text-ink hover:text-navy-950 hover:underline"
              >
                {m.name}
              </a>
              {m.canDrive && <Pill>{c.drives}</Pill>}
              {m.canAttend && <Pill>{c.attends}</Pill>}
              <span className="flex-1" />
              <span className="text-caption text-ink-muted">
                {c.routesOf(routesOf(m.personId))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Each fare zone's yearly fee, set and changed here; current riders are billed with a preview. */
export function FeesTab({
  ctx,
  fees,
  canSet,
  canIssue,
}: {
  ctx: Ctx;
  fees: ReturnType<typeof useZoneFees>;
  canSet: boolean;
  canIssue: boolean;
}) {
  const f = t.fees;
  const [editing, setEditing] = useState<{ id: string; number: number } | null>(null);
  const [preview, setPreview] = useState<{
    zone: number;
    planId: string;
    p: IssuePreview;
  } | null>(null);
  const ask = useMutation({
    mutationFn: async (x: { zone: number; planId: string }) => ({
      ...x,
      p: await api.post<IssuePreview>(`/finance/plans/${x.planId}/issue/preview`),
    }),
    onSuccess: setPreview,
  });
  const issue = useMutation({
    mutationFn: (planId: string) => api.post<IssuePreview>(`/finance/plans/${planId}/issue`),
    onSuccess: (r) => {
      setPreview(null);
      ctx.onDone(f.issued(r.invoices));
      void fees.refetch();
    },
  });
  const byZone = new Map((fees.data ?? []).map((x) => [x.groupId, x]));
  const stopsIn = (zone: number) => ctx.data.stops.filter((s) => s.fareZone === zone).length;
  return (
    <Section title={f.title} description={f.lead} flush>
      {fees.data === null ? (
        <EmptyState compact title={f.denied} />
      ) : ctx.data.zones.length === 0 ? (
        <EmptyState compact icon={IndianRupee} area="amber" title={f.noZones} />
      ) : (
        <ul className="divide-y divide-line">
          {ctx.data.zones.map((z) => {
            const fee = byZone.get(z.id);
            return (
              <li key={z.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="flex min-w-40 flex-col">
                  <span className="text-body font-semibold text-ink">{f.zone(z.number)}</span>
                  <span className="text-caption text-ink-muted">
                    {f.stopsIn(stopsIn(z.number))}
                  </span>
                </div>
                {fee ? (
                  <div className="flex flex-1 flex-col">
                    <span className="tabular text-body font-medium text-ink">
                      {f.perYear(rupees(fee.totalPaise))}
                      <span className="block text-caption font-normal text-ink-muted">
                        {f.oneWay(rupees(Math.floor(fee.totalPaise / 2)))}
                      </span>
                    </span>
                    <span className="text-caption text-ink-muted">
                      {fee.instalments.map((i) => `${i.label} ${date(i.dueOn)}`).join(' · ')}
                      {' · '}
                      {f.billed(fee.billed)}
                    </span>
                  </div>
                ) : (
                  <span className="flex-1">
                    <Pill tone="warn">{f.noFee}</Pill>
                  </span>
                )}
                {fee && canIssue && (
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={ask.isPending}
                    onClick={() => ask.mutate({ zone: z.number, planId: fee.planId })}
                  >
                    {f.issue}
                  </Button>
                )}
                {canSet && (
                  <Button
                    variant={fee ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => setEditing(z)}
                  >
                    {fee ? null : <Plus aria-hidden className="size-4" />}
                    {fee ? f.change : f.set}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <ZoneFeeModal
          institutionId={ctx.institutionId}
          zone={editing}
          current={byZone.get(editing.id)}
          onClose={() => setEditing(null)}
          onDone={() => {
            ctx.onDone(f.saved(editing.number));
            setEditing(null);
            void fees.refetch();
          }}
        />
      )}
      <PreviewCanvas
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={preview ? f.issueTitle(preview.zone) : ''}
        actionLabel={f.issue}
        changes={
          preview && preview.p.invoices > 0
            ? [
                f.issueBody(preview.p.students, preview.p.invoices, rupees(preview.p.totalPaise)),
                ...en.fees.issueChanges(rupees(preview.p.totalPaise)).slice(1),
              ]
            : [f.issueNothing]
        }
        affected={[
          { label: en.fees.issueStudents, count: preview?.p.students ?? 0 },
          { label: en.fees.issueInvoices, count: preview?.p.invoices ?? 0 },
          { label: en.fees.issueAlready, count: preview?.p.alreadyIssued ?? 0 },
        ]}
        risks={[]}
        undo={en.fees.issueUndo}
        busy={issue.isPending}
        labels={en.preview}
        onConfirm={() => preview && issue.mutate(preview.planId)}
      />
    </Section>
  );
}

function ZoneFeeModal({
  institutionId,
  zone,
  current,
  onClose,
  onDone,
}: {
  institutionId: string;
  zone: { id: string; number: number };
  current: GroupFee | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const f = t.fees;
  const today = istToday();
  const [amount, setAmount] = useState(
    current ? rupees(current.totalPaise).replace('₹', '').replace(/\.00$/, '') : '',
  );
  const [schedule, setSchedule] = useState<Schedule>(
    current?.instalments.length === 10
      ? 'monthly'
      : current?.instalments.length === 3
        ? 'three_terms'
        : current?.instalments.length === 2
          ? 'two_terms'
          : 'annual',
  );
  const paise = parseRupees(amount);
  const insts = instalmentsFor(schedule, today);
  const parts = paise
    ? splitPaise(
        paise,
        insts.map((i) => i.shareBp),
      )
    : [];
  const save = useMutation({
    mutationFn: () =>
      api.post(`/transport/zones/${zone.id}/fee`, {
        institutionId,
        amountPaise: paise,
        instalments: insts,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={f.setFor(zone.number)}
      submitLabel={f.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!paise || paise < 100}
      error={save.error ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.amount}>
        <input
          required
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={cx(fieldInput, 'tabular')}
        />
      </ModalField>
      <ModalField label={f.schedule}>
        <select
          value={schedule}
          onChange={(e) => setSchedule(e.target.value as Schedule)}
          className={fieldInput}
        >
          {SCHEDULES.map((s) => (
            <option key={s} value={s}>
              {f.schedules[s]}
            </option>
          ))}
        </select>
      </ModalField>
      <ul className="flex flex-col gap-1 rounded-xl bg-paper px-4 py-3 sm:col-span-2">
        {insts.map((i, n) => (
          <li key={i.dueOn} className="flex items-center gap-3 text-caption">
            <span className="w-16 font-medium text-ink">{i.label}</span>
            <span
              className={cx('flex-1', i.dueOn < today ? 'text-signal-warn-ink' : 'text-ink-muted')}
            >
              {date(i.dueOn)}
            </span>
            <span className="tabular font-medium text-ink">
              {parts[n] !== undefined ? rupees(parts[n]) : '—'}
            </span>
          </li>
        ))}
        {insts.some((i) => i.dueOn < today) && (
          <li className="pt-1 text-caption text-signal-warn-ink">{f.past}</li>
        )}
      </ul>
    </FormModal>
  );
}
