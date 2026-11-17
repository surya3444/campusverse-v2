'use client';

import type {
  CrewMember,
  DocumentKind,
  DocumentStatus,
  Route,
  Stop,
  TransportSetup,
  Vehicle,
} from '@campusverse/shared-transport';
import {
  Announcer,
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
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Bus,
  MapPin,
  Pencil,
  Plus,
  Route as RouteIcon,
  Users,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { Reports } from './reports-tab';
import {
  CrewList,
  CrewModal,
  FeesTab,
  SetupGuide,
  useZoneFees,
  type GuideStep,
} from './setup-guide';
import { Riders } from './riders-tab';
import { Today } from './today-tab';
import { date, errorText, t, type Ctx } from './shared';
import { useUrlTab } from '../common/url-tab';

const KINDS: DocumentKind[] = ['registration', 'fitness', 'insurance', 'permit', 'pollution'];
const TONE: Record<DocumentStatus, Tone> = { valid: 'go', expiring: 'warn', expired: 'stop' };

type Tab = 'today' | 'riders' | 'vehicles' | 'routes' | 'stops' | 'fees' | 'reports';

const checkNames = (kinds: string[]) =>
  kinds.map((k) => en.staffPages.checks.kinds[k] ?? k).join(', ');

export function TransportView() {
  const { institutionId: id } = useInstitution();
  const me = useMe();
  const { can } = me;
  const router = useRouter();
  // A driver sees only their driving screen.
  const driverOnly = me.isSuccess && !can('transport.trip.read') && can('transport.trip.drive');
  useEffect(() => {
    if (driverOnly) router.replace('/transport/drive');
  }, [driverOnly, router]);
  const qc = useQueryClient();
  const key = ['transport', id];
  const view = useQuery({
    queryKey: key,
    queryFn: () => api.get<TransportSetup>(`/transport/setup?institutionId=${id}`),
    enabled: !!id,
  });
  const [tab, setTab] = useUrlTab<Tab>(
    ['today', 'riders', 'vehicles', 'routes', 'stops', 'fees', 'reports'],
    'today',
  );
  const [message, setMessage] = useState<string | null>(null);
  /** A guide step opens its tab with the form already open (a counter, so it opens each time). */
  const [opening, setOpening] = useState<{ tab: Tab; n: number } | null>(null);
  const [crewFor, setCrewFor] = useState<'driver' | 'attendant' | null>(null);
  const zoneFees = useZoneFees(
    {
      institutionId: id ?? '',
      data: view.data ?? { vehicles: [], stops: [], routes: [], crew: [], zones: [] },
    },
    !!id && !!view.data && can('finance.invoice.read'),
  );
  const canAddCrew = can('people.staff.create') && can('platform.role.assign');
  const step = (s: GuideStep) => {
    if (s === 'crew') {
      if (canAddCrew) setCrewFor('driver');
      setTab('routes');
      return;
    }
    const to: Tab =
      s === 'vehicles' ? 'vehicles' : s === 'stops' ? 'stops' : s === 'routes' ? 'routes' : 'fees';
    setTab(to);
    if (to !== 'fees') setOpening((o) => ({ tab: to, n: (o?.n ?? 0) + 1 }));
  };

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const ctx: Ctx | null =
    id && view.data
      ? {
          institutionId: id,
          data: view.data,
          manageVehicles: can('transport.vehicle.manage'),
          manageRoutes: can('transport.route.manage'),
          manageRiders: can('transport.assignment.manage'),
          attend: can('transport.trip.attend'),
          drive: can('transport.trip.drive'),
          onDone: (m) => {
            setMessage(m ?? t.saved);
            void qc.invalidateQueries({ queryKey: key });
          },
        }
      : null;
  const openNew = (which: Tab) => (opening?.tab === which ? opening.n : 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Bus}
        art="transport"
        area="amber"
        eyebrow={en.systems.groups.operations}
        title={t.title}
        description={t.lead}
      />
      {!id || view.isPending ? (
        <SkeletonRows rows={6} label={en.states.loading.title} />
      ) : view.isError || !ctx ? (
        view.error instanceof ApiFailure && view.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : offline ? (
          <StatePanel
            kind="offline"
            title={en.states.offline.title}
            body={en.states.offline.body}
          />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} />
        )
      ) : (
        <>
          <KeyFigures
            label={t.title}
            figures={[
              {
                label: t.figures.vehicles,
                value: String(ctx.data.vehicles.filter((v) => v.active).length),
                icon: Bus,
              },
              {
                label: t.figures.routes,
                value: String(ctx.data.routes.filter((r) => r.active).length),
                icon: RouteIcon,
              },
              {
                label: t.figures.seats,
                value: String(
                  ctx.data.vehicles.filter((v) => v.active).reduce((n, v) => n + v.seats, 0),
                ),
                icon: Users,
              },
              {
                label: t.figures.stops,
                value: String(ctx.data.stops.filter((x) => x.active).length),
                icon: MapPin,
              },
            ]}
          />
          <SetupGuide
            ctx={ctx}
            fees={can('finance.invoice.read') ? zoneFees.data : null}
            onStep={step}
          />
          <Segmented
            label={t.tabsLabel}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'today', label: t.tabs.today },
              { value: 'riders', label: t.tabs.riders },
              { value: 'routes', label: t.tabs.routes, count: ctx.data.routes.length },
              { value: 'stops', label: t.tabs.stops, count: ctx.data.stops.length },
              { value: 'vehicles', label: t.tabs.vehicles, count: ctx.data.vehicles.length },
              { value: 'fees', label: t.tabs.fees },
              { value: 'reports', label: t.tabs.reports },
            ]}
          />
          {tab === 'today' && <Today {...ctx} />}
          {tab === 'riders' && <Riders {...ctx} />}
          {tab === 'vehicles' && <Vehicles {...ctx} openNew={openNew('vehicles')} />}
          {tab === 'routes' && (
            <>
              <Routes {...ctx} openNew={openNew('routes')} />
              <CrewList ctx={ctx} canAdd={canAddCrew} onAdd={setCrewFor} />
            </>
          )}
          {tab === 'stops' && <Stops {...ctx} openNew={openNew('stops')} />}
          {tab === 'fees' && (
            <FeesTab
              ctx={ctx}
              fees={zoneFees}
              canSet={can('finance.plan.manage')}
              canIssue={can('finance.invoice.issue')}
            />
          )}
          {tab === 'reports' && <Reports {...ctx} />}
        </>
      )}
      {crewFor && id && (
        <CrewModal
          institutionId={id}
          role={crewFor}
          onClose={() => setCrewFor(null)}
          onDone={(m) => {
            setCrewFor(null);
            setMessage(m);
            void qc.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

const Field = ModalField;

/** Opens a tab's "add" form when the guide asks (each new number opens it once). */
function useOpenNew<T>(n: number, open: (v: T) => void, value: T) {
  useEffect(() => {
    if (n > 0) open(value);
    // Only a new number opens it; the form value and setter are stable enough to leave out.
  }, [n]);
}

/** A create or edit form for this screen, in a modal over the list. */
function FormRow({
  label,
  description,
  onSubmit,
  onCancel,
  pending,
  error,
  size = 'lg',
  children,
}: {
  label: string;
  description?: string;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  error: unknown;
  size?: 'md' | 'lg';
  children: ReactNode;
}) {
  return (
    <FormModal
      title={label}
      {...(description ? { description } : {})}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={pending}
      error={error ? errorText(error) : null}
      size={size}
      onClose={onCancel}
      onSubmit={onSubmit}
    >
      {children}
    </FormModal>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-navy-50 hover:text-navy-950"
    >
      {children}
    </button>
  );
}

function ActiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 self-end pb-2.5 text-body text-ink sm:col-span-2">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {t.active}
    </label>
  );
}

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

type VehicleForm = {
  id?: string;
  registration: string;
  kind: Vehicle['kind'];
  seats: number;
  ownedBy: Vehicle['ownedBy'];
  contractorName: string;
  active: boolean;
};
const NEW_VEHICLE: VehicleForm = {
  registration: '',
  kind: 'bus',
  seats: 40,
  ownedBy: 'school',
  contractorName: '',
  active: true,
};

function Vehicles({
  institutionId,
  data,
  manageVehicles,
  onDone,
  openNew,
}: Ctx & { openNew: number }) {
  const v = t.vehicles;
  const [form, setForm] = useState<VehicleForm | null>(null);
  useOpenNew(openNew, setForm, NEW_VEHICLE);
  const save = useMutation({
    mutationFn: (f: VehicleForm) => api.post('/transport/vehicles', { ...f, institutionId }),
    onSuccess: () => {
      setForm(null);
      onDone();
    },
  });
  return (
    <Section
      title={t.tabs.vehicles}
      flush
      actions={
        manageVehicles && !form ? (
          <Button variant="secondary" onClick={() => setForm(NEW_VEHICLE)}>
            <Plus aria-hidden className="size-4" />
            {v.add}
          </Button>
        ) : undefined
      }
    >
      {form && (
        <FormRow
          label={form.id ? `${t.edit}: ${form.registration}` : v.add}
          pending={save.isPending}
          error={save.error}
          onSubmit={() => save.mutate(form)}
          onCancel={() => {
            save.reset();
            setForm(null);
          }}
        >
          <Field label={v.registration} hint={v.registrationHint}>
            <input
              required
              maxLength={20}
              value={form.registration}
              onChange={(e) => setForm({ ...form, registration: e.target.value })}
              className={cx(fieldInput, 'uppercase')}
            />
          </Field>
          <Field label={v.kind}>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as Vehicle['kind'] })}
              className={fieldInput}
            >
              {Object.entries(v.kinds).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={v.seats}>
            <input
              required
              type="number"
              min={1}
              max={120}
              value={form.seats}
              onChange={(e) => setForm({ ...form, seats: Number(e.target.value) })}
              className={cx(fieldInput, 'tabular')}
            />
          </Field>
          <Field label={v.ownedBy}>
            <select
              value={form.ownedBy}
              onChange={(e) => setForm({ ...form, ownedBy: e.target.value as Vehicle['ownedBy'] })}
              className={fieldInput}
            >
              {Object.entries(v.owners).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {form.ownedBy === 'contractor' && (
            <Field label={v.contractorName}>
              <input
                maxLength={120}
                value={form.contractorName}
                onChange={(e) => setForm({ ...form, contractorName: e.target.value })}
                className={fieldInput}
              />
            </Field>
          )}
          <ActiveToggle value={form.active} onChange={(active) => setForm({ ...form, active })} />
        </FormRow>
      )}
      {data.vehicles.length === 0 ? (
        <EmptyState compact art="transport" title={v.empty} body={v.emptyBody} />
      ) : (
        <ul className="divide-y divide-line">
          {data.vehicles.map((x) => (
            <VehicleRow
              key={x.id}
              vehicle={x}
              institutionId={institutionId}
              manage={manageVehicles}
              onEdit={() =>
                setForm({
                  id: x.id,
                  registration: x.registration,
                  kind: x.kind,
                  seats: x.seats,
                  ownedBy: x.ownedBy,
                  contractorName: x.contractorName ?? '',
                  active: x.active,
                })
              }
              onDone={onDone}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function VehicleRow({
  vehicle: x,
  institutionId,
  manage,
  onEdit,
  onDone,
}: {
  vehicle: Vehicle;
  institutionId: string;
  manage: boolean;
  onEdit: () => void;
  onDone: () => void;
}) {
  const v = t.vehicles;
  const [doc, setDoc] = useState<{ kind: DocumentKind; number: string; validUntil: string } | null>(
    null,
  );
  const add = useMutation({
    mutationFn: (d: NonNullable<typeof doc>) =>
      api.post(`/transport/vehicles/${x.id}/documents`, {
        institutionId,
        kind: d.kind,
        number: d.number || null,
        validUntil: d.validUntil,
      }),
    onSuccess: () => {
      setDoc(null);
      onDone();
    },
  });
  return (
    <li className={cx('flex flex-col gap-3 px-5 py-4', !x.active && 'bg-paper/60')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="tabular rounded-md bg-amber-tint px-2 py-0.5 text-body font-semibold text-amber-ink">
          {x.registration}
        </span>
        <span className="text-body text-ink">
          {v.kinds[x.kind]} · <span className="tabular">{v.seatsShort(x.seats)}</span>
          {x.ownedBy === 'contractor' && ` · ${x.contractorName ?? v.owners.contractor}`}
        </span>
        {!x.active && <Pill>{t.inactive}</Pill>}
        <span className="flex-1" />
        {x.blocked.length > 0 ? (
          <Pill tone="stop">
            {v.blocked(x.blocked.map((k) => v.documents[k]?.toLowerCase()).join(', '))}
          </Pill>
        ) : (
          <Pill tone="go">{v.ready}</Pill>
        )}
        {manage && (
          <IconButton label={`${t.edit}: ${x.registration}`} onClick={onEdit}>
            <Pencil aria-hidden className="size-4" />
          </IconButton>
        )}
      </div>
      <ul className="flex flex-wrap gap-2" aria-label={`${x.registration}: ${v.documentKind}`}>
        {KINDS.map((k) => {
          const d = x.documents[k];
          return (
            <li key={k} className="flex items-center gap-1.5 text-caption">
              <span className="font-medium text-ink">{v.documents[k]}</span>
              {d ? (
                <Pill tone={TONE[d.status]}>{v.status[d.status](date(d.validUntil))}</Pill>
              ) : (
                <Pill tone={x.blocked.includes(k) ? 'stop' : 'neutral'}>{v.status.missing}</Pill>
              )}
            </li>
          );
        })}
      </ul>
      {manage && doc && (
        <FormRow
          label={`${v.addDocument}: ${x.registration}`}
          size="md"
          pending={add.isPending}
          error={add.error}
          onSubmit={() => add.mutate(doc)}
          onCancel={() => {
            add.reset();
            setDoc(null);
          }}
        >
          <Field label={v.documentKind}>
            <select
              value={doc.kind}
              onChange={(e) => setDoc({ ...doc, kind: e.target.value as DocumentKind })}
              className={fieldInput}
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {v.documents[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label={v.documentNumber}>
            <input
              maxLength={60}
              value={doc.number}
              onChange={(e) => setDoc({ ...doc, number: e.target.value })}
              className={fieldInput}
            />
          </Field>
          <Field label={v.validUntil}>
            <input
              required
              type="date"
              value={doc.validUntil}
              onChange={(e) => setDoc({ ...doc, validUntil: e.target.value })}
              className={fieldInput}
            />
          </Field>
        </FormRow>
      )}
      {manage && (
        <div>
          <Button
            variant="quiet"
            onClick={() => setDoc({ kind: x.blocked[0] ?? 'fitness', number: '', validUntil: '' })}
          >
            <Plus aria-hidden className="size-4" />
            {v.addDocument}
          </Button>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------------------------
// Stops
// ---------------------------------------------------------------------------------------------

type StopForm = {
  id?: string;
  name: string;
  landmark: string;
  fareZone: string;
  latitude: string;
  longitude: string;
  active: boolean;
};
const NEW_STOP: StopForm = {
  name: '',
  landmark: '',
  fareZone: '',
  latitude: '',
  longitude: '',
  active: true,
};

function Stops({ institutionId, data, manageRoutes, onDone, openNew }: Ctx & { openNew: number }) {
  const s = t.stops;
  const [form, setForm] = useState<StopForm | null>(null);
  useOpenNew(openNew, setForm, NEW_STOP);
  const save = useMutation({
    mutationFn: (f: StopForm) =>
      api.post('/transport/stops', {
        institutionId,
        id: f.id,
        name: f.name,
        landmark: f.landmark || null,
        fareZone: f.fareZone ? Number(f.fareZone) : null,
        location:
          f.latitude && f.longitude ? { lat: Number(f.latitude), lng: Number(f.longitude) } : null,
        active: f.active,
      }),
    onSuccess: () => {
      setForm(null);
      onDone();
    },
  });
  const routesAt = (stopId: string) =>
    data.routes.filter((r) => r.stops.some((x) => x.stopId === stopId)).length;
  return (
    <Section
      title={t.tabs.stops}
      flush
      actions={
        manageRoutes && !form ? (
          <Button variant="secondary" onClick={() => setForm(NEW_STOP)}>
            <Plus aria-hidden className="size-4" />
            {s.add}
          </Button>
        ) : undefined
      }
    >
      {form && (
        <FormRow
          label={form.id ? `${t.edit}: ${form.name}` : s.add}
          pending={save.isPending}
          error={save.error}
          onSubmit={() => save.mutate(form)}
          onCancel={() => {
            save.reset();
            setForm(null);
          }}
        >
          <Field label={s.name}>
            <input
              required
              maxLength={80}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={fieldInput}
            />
          </Field>
          <Field label={s.landmark}>
            <input
              maxLength={120}
              value={form.landmark}
              onChange={(e) => setForm({ ...form, landmark: e.target.value })}
              className={fieldInput}
            />
          </Field>
          <Field label={s.fareZone} hint={s.fareZoneHint}>
            <input
              type="number"
              min={1}
              max={20}
              value={form.fareZone}
              onChange={(e) => setForm({ ...form, fareZone: e.target.value })}
              className={cx(fieldInput, 'tabular')}
            />
          </Field>
          <Field label={s.latitude}>
            <input
              type="number"
              step="0.000001"
              min={-90}
              max={90}
              required={!!form.longitude}
              value={form.latitude}
              onChange={(e) => setForm({ ...form, latitude: e.target.value })}
              className={cx(fieldInput, 'tabular')}
            />
          </Field>
          <Field label={s.longitude}>
            <input
              type="number"
              step="0.000001"
              min={-180}
              max={180}
              required={!!form.latitude}
              value={form.longitude}
              onChange={(e) => setForm({ ...form, longitude: e.target.value })}
              className={cx(fieldInput, 'tabular')}
            />
          </Field>
          <ActiveToggle value={form.active} onChange={(active) => setForm({ ...form, active })} />
        </FormRow>
      )}
      {data.stops.length === 0 ? (
        <EmptyState compact art="transport" title={s.empty} body={s.emptyBody} />
      ) : (
        <ul className="divide-y divide-line">
          {data.stops.map((x) => (
            <li
              key={x.id}
              className={cx(
                'flex flex-wrap items-center gap-3 px-5 py-3',
                !x.active && 'bg-paper/60',
              )}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">{x.name}</span>
                {x.landmark && (
                  <span className="block truncate text-caption text-ink-muted">{x.landmark}</span>
                )}
              </span>
              {x.fareZone !== null && <Pill>{s.zone(x.fareZone)}</Pill>}
              {!x.active && <Pill>{t.inactive}</Pill>}
              <span className="tabular text-caption text-ink-muted">
                {s.onRoutes(routesAt(x.id))}
              </span>
              {manageRoutes && (
                <IconButton
                  label={`${t.edit}: ${x.name}`}
                  onClick={() =>
                    setForm({
                      id: x.id,
                      name: x.name,
                      landmark: x.landmark ?? '',
                      fareZone: x.fareZone?.toString() ?? '',
                      latitude: x.latitude?.toString() ?? '',
                      longitude: x.longitude?.toString() ?? '',
                      active: x.active,
                    })
                  }
                >
                  <Pencil aria-hidden className="size-4" />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

type RouteForm = {
  id?: string;
  name: string;
  direction: Route['direction'];
  vehicleId: string;
  driverPersonId: string;
  attendantPersonId: string;
  active: boolean;
  stops: { stopId: string; plannedAt: string }[];
};
const NEW_ROUTE: RouteForm = {
  name: '',
  direction: 'pickup',
  vehicleId: '',
  driverPersonId: '',
  attendantPersonId: '',
  active: true,
  stops: [],
};

function Routes({ institutionId, data, manageRoutes, onDone, openNew }: Ctx & { openNew: number }) {
  const r = t.routes;
  const [form, setForm] = useState<RouteForm | null>(null);
  useOpenNew(openNew && data.stops.length > 0 ? openNew : 0, setForm, NEW_ROUTE);
  const crewName = new Map(data.crew.map((m) => [m.personId, m.name]));
  const stopName = new Map(data.stops.map((s) => [s.id, s.name]));
  const vehicle = new Map(data.vehicles.map((v) => [v.id, v]));
  const save = useMutation({
    mutationFn: (f: RouteForm) =>
      api.post('/transport/routes', {
        ...f,
        institutionId,
        vehicleId: f.vehicleId || null,
        driverPersonId: f.driverPersonId || null,
        attendantPersonId: f.attendantPersonId || null,
      }),
    onSuccess: () => {
      setForm(null);
      onDone();
    },
  });
  return (
    <Section
      title={t.tabs.routes}
      flush
      actions={
        manageRoutes && !form && data.stops.length > 0 ? (
          <Button variant="secondary" onClick={() => setForm(NEW_ROUTE)}>
            <Plus aria-hidden className="size-4" />
            {r.add}
          </Button>
        ) : undefined
      }
    >
      {form && (
        <RouteEditor
          form={form}
          setForm={setForm}
          stops={data.stops}
          vehicles={data.vehicles}
          crew={data.crew}
          pending={save.isPending}
          error={save.error}
          onSave={() => save.mutate(form)}
          onCancel={() => {
            save.reset();
            setForm(null);
          }}
        />
      )}
      {data.routes.length === 0 ? (
        <EmptyState
          compact
          art="transport"
          title={r.empty}
          body={data.stops.length === 0 ? r.needStops : r.emptyBody}
        />
      ) : (
        <ul className="divide-y divide-line">
          {data.routes.map((x) => {
            const bus = x.vehicleId ? vehicle.get(x.vehicleId) : undefined;
            return (
              <li
                key={x.id}
                className={cx('flex flex-col gap-2 px-5 py-4', !x.active && 'bg-paper/60')}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-body font-semibold text-ink">{x.name}</span>
                  <Pill>{r.directions[x.direction]}</Pill>
                  {bus && (
                    <Pill tone={bus.blocked.length ? 'stop' : 'neutral'}>{bus.registration}</Pill>
                  )}
                  {!x.active && <Pill>{t.inactive}</Pill>}
                  <span className="flex-1" />
                  <span className="tabular text-caption text-ink-muted">
                    {r.stopCount(x.stops.length)}
                  </span>
                  {manageRoutes && (
                    <IconButton
                      label={`${t.edit}: ${x.name}`}
                      onClick={() =>
                        setForm({
                          id: x.id,
                          name: x.name,
                          direction: x.direction,
                          vehicleId: x.vehicleId ?? '',
                          driverPersonId: x.driverPersonId ?? '',
                          attendantPersonId: x.attendantPersonId ?? '',
                          active: x.active,
                          stops: x.stops.map(({ stopId, plannedAt }) => ({ stopId, plannedAt })),
                        })
                      }
                    >
                      <Pencil aria-hidden className="size-4" />
                    </IconButton>
                  )}
                </div>
                <p className="text-caption text-ink-muted">
                  {x.driverPersonId || x.attendantPersonId
                    ? r.crewLine(
                        x.driverPersonId ? (crewName.get(x.driverPersonId) ?? null) : null,
                        x.attendantPersonId ? (crewName.get(x.attendantPersonId) ?? null) : null,
                      )
                    : r.noCrew}
                </p>
                <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-ink-muted">
                  {x.stops.map((s, i) => (
                    <li key={s.seq} className="flex items-center gap-2">
                      {i > 0 && <span aria-hidden>→</span>}
                      <span>
                        <span className="tabular font-medium text-ink">{s.plannedAt}</span>{' '}
                        {stopName.get(s.stopId)}
                      </span>
                    </li>
                  ))}
                </ol>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function RouteEditor({
  form,
  setForm,
  stops,
  vehicles,
  crew,
  pending,
  error,
  onSave,
  onCancel,
}: {
  form: RouteForm;
  setForm: (f: RouteForm) => void;
  stops: Stop[];
  vehicles: Vehicle[];
  crew: CrewMember[];
  pending: boolean;
  error: unknown;
  onSave: () => void;
  onCancel: () => void;
}) {
  const r = t.routes;
  const used = new Set(form.stops.map((s) => s.stopId));
  const available = stops.filter((s) => s.active && !used.has(s.id));
  const chosen = vehicles.find((v) => v.id === form.vehicleId);
  const setStops = (next: RouteForm['stops']) => setForm({ ...form, stops: next });
  const move = (i: number, by: -1 | 1) => {
    const next = [...form.stops];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    setStops(next);
  };
  const stopName = new Map(stops.map((s) => [s.id, s.name]));
  return (
    <FormRow
      label={form.id ? `${t.edit}: ${form.name}` : r.add}
      pending={pending}
      error={error}
      onSubmit={onSave}
      onCancel={onCancel}
    >
      <Field label={r.name}>
        <input
          required
          maxLength={80}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className={fieldInput}
        />
      </Field>
      <Field label={r.direction}>
        <select
          value={form.direction}
          onChange={(e) => setForm({ ...form, direction: e.target.value as Route['direction'] })}
          className={fieldInput}
        >
          {Object.entries(r.directions).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={r.vehicle} hint={chosen?.blocked.length ? r.vehicleBlocked : undefined}>
        <select
          value={form.vehicleId}
          onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
          className={fieldInput}
        >
          <option value="">{r.noVehicle}</option>
          {vehicles
            .filter((v) => v.active || v.id === form.vehicleId)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.registration} · {t.vehicles.seatsShort(v.seats)}
              </option>
            ))}
        </select>
      </Field>
      <CrewPick
        label={r.driver}
        crew={crew}
        value={form.driverPersonId}
        other={form.attendantPersonId}
        lacks={(m) =>
          !m.canDrive
            ? r.lacksDriver(m.name)
            : m.driverChecksMissing.length > 0
              ? r.checksMissing(m.name, checkNames(m.driverChecksMissing))
              : null
        }
        onChange={(driverPersonId) => setForm({ ...form, driverPersonId })}
      />
      <CrewPick
        label={r.attendant}
        crew={crew}
        value={form.attendantPersonId}
        other={form.driverPersonId}
        lacks={(m) =>
          !m.canAttend
            ? r.lacksAttendant(m.name)
            : m.attendantChecksMissing.length > 0
              ? r.checksMissing(m.name, checkNames(m.attendantChecksMissing))
              : null
        }
        onChange={(attendantPersonId) => setForm({ ...form, attendantPersonId })}
      />
      <fieldset className="flex flex-col gap-2 sm:col-span-2">
        <legend className="mb-1.5 text-caption font-medium text-ink">{r.stopsTitle}</legend>
        <ol className="flex flex-col gap-2">
          {form.stops.map((s, i) => (
            <li key={s.stopId} className="flex flex-wrap items-center gap-2">
              <span className="tabular w-6 text-caption text-ink-muted">{i + 1}.</span>
              <span className="min-w-40 flex-1 text-body text-ink">{stopName.get(s.stopId)}</span>
              <input
                type="time"
                required
                aria-label={`${r.time}: ${stopName.get(s.stopId) ?? ''}`}
                value={s.plannedAt}
                onChange={(e) =>
                  setStops(
                    form.stops.map((x, j) => (j === i ? { ...x, plannedAt: e.target.value } : x)),
                  )
                }
                className={cx(fieldInput, 'tabular w-32')}
              />
              {i > 0 && (
                <IconButton
                  label={`${r.moveUp}: ${stopName.get(s.stopId) ?? ''}`}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp aria-hidden className="size-4" />
                </IconButton>
              )}
              {i < form.stops.length - 1 && (
                <IconButton
                  label={`${r.moveDown}: ${stopName.get(s.stopId) ?? ''}`}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                </IconButton>
              )}
              <IconButton
                label={`${r.remove}: ${stopName.get(s.stopId) ?? ''}`}
                onClick={() => setStops(form.stops.filter((_, j) => j !== i))}
              >
                <X aria-hidden className="size-4" />
              </IconButton>
            </li>
          ))}
        </ol>
        {available.length > 0 && (
          <select
            aria-label={r.addStop}
            value=""
            onChange={(e) =>
              e.target.value &&
              setStops([
                ...form.stops,
                { stopId: e.target.value, plannedAt: form.stops.at(-1)?.plannedAt ?? '07:00' },
              ])
            }
            className={cx(fieldInput, 'sm:max-w-sm')}
          >
            <option value="">{r.chooseStop}</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      <ActiveToggle value={form.active} onChange={(active) => setForm({ ...form, active })} />
    </FormRow>
  );
}

/** A route's usual driver or attendant, from the school's staff, warning when their role is missing. */
function CrewPick({
  label,
  crew,
  value,
  other,
  lacks,
  onChange,
}: {
  label: string;
  crew: CrewMember[];
  value: string;
  other: string;
  lacks: (m: CrewMember) => string | null;
  onChange: (personId: string) => void;
}) {
  const r = t.routes;
  const chosen = crew.find((m) => m.personId === value);
  return (
    <Field label={label} hint={(chosen && lacks(chosen)) || r.crewHint}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={fieldInput}>
        <option value="">{r.nobody}</option>
        {crew
          .filter((m) => m.personId !== other)
          .map((m) => (
            <option key={m.personId} value={m.personId}>
              {m.name}
              {m.designation ? ` · ${m.designation}` : ''}
            </option>
          ))}
      </select>
    </Field>
  );
}
