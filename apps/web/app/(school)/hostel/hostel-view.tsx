'use client';

// The hostel (docs/specs/HOSTEL.md): rooms and beds with allocation, the roll call, and outpasses.
// The roll call is built for a warden's phone.
import type {
  Bed,
  HostelFigures,
  HostelRow,
  OutpassRow,
  OutpassView,
  RollLine,
  RoomRow,
} from '@campusverse/shared-hostel';
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
import { Hotel, Plus, Users, BedDouble, DoorOpen, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { ReasonDialog } from '../reason-dialog';
import { useUrlTab } from '../common/url-tab';

const t = en.hostel;
type Tab = 'rooms' | 'roll' | 'outpasses';
type Student = { personId: string; name: string; label: string | null; bed: string | null };
type Mark = 'present' | 'absent' | 'on_leave';

const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d.slice(0, 10)}T00:00:00Z`),
  );
const time = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
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
    for (const k of [
      'hostel-figures',
      'hostels',
      'hostel-rooms',
      'hostel-roll',
      'hostel-outpasses',
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

export function HostelView() {
  const school = useInstitution();
  const { can } = useMe();
  const [tab, setTab] = useUrlTab<Tab>(['rooms', 'roll', 'outpasses'], 'rooms');
  const [hostelId, setHostelId] = useState<string | null>(null);
  const id = school.institutionId;
  const figures = useQuery({
    queryKey: ['hostel-figures', id],
    queryFn: () => api.get<HostelFigures>(`/hostel/figures?institutionId=${id}`),
    enabled: !!id,
  });
  const list = useQuery({
    queryKey: ['hostels', id],
    queryFn: () => api.get<HostelRow[]>(`/hostel/hostels?institutionId=${id}`),
    enabled: !!id,
  });
  const active = (list.data ?? []).filter((h) => h.active);
  const chosen = active.find((h) => h.id === hostelId) ?? active[0] ?? null;
  const f = figures.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Hotel}
        art="welcome"
        area="amber"
        eyebrow={en.nav.groups.services}
        title={t.title}
        description={t.lead}
        actions={
          <Segmented
            label={t.tabsLabel}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'rooms' as const, label: t.tabs.rooms },
              { value: 'roll' as const, label: t.tabs.roll },
              { value: 'outpasses' as const, label: t.tabs.outpasses },
            ]}
          />
        }
      />
      {f && (
        <KeyFigures
          label={t.figures}
          figures={[
            { label: t.fig.residents, icon: Users, value: String(f.residents) },
            { label: t.fig.freeBeds, icon: BedDouble, value: String(f.freeBeds) },
            {
              label: t.fig.out,
              icon: DoorOpen,
              value: String(f.out),
              ...(f.overdue
                ? { note: t.fig.overdue(f.overdue), tone: 'warn' as const }
                : f.requested
                  ? { note: t.fig.requested(f.requested) }
                  : {}),
            },
            {
              label: t.fig.absent,
              icon: UserX,
              value: String(f.absentLastRollCall),
              ...(f.absentLastRollCall ? { tone: 'warn' as const } : {}),
            },
          ]}
        />
      )}
      {!id || figures.isError || !list.data ? (
        <QueryState q={!id ? { isPending: true, error: null } : figures.isError ? figures : list} />
      ) : tab === 'outpasses' ? (
        <Outpasses institutionId={id} decide={can('hostel.outpass.decide')} />
      ) : list.data.length === 0 ? (
        <NoHostel institutionId={id} manage={can('hostel.room.manage')} />
      ) : (
        <div className="flex flex-col gap-4">
          {active.length > 1 && (
            <Segmented
              label={t.hostel}
              value={chosen?.id ?? ''}
              onChange={setHostelId}
              options={active.map((h) => ({ value: h.id, label: h.name }))}
            />
          )}
          {chosen && tab === 'rooms' && (
            <Rooms
              institutionId={id}
              hostel={chosen}
              hostels={list.data}
              manage={can('hostel.room.manage')}
            />
          )}
          {chosen && tab === 'roll' && (
            <RollCall institutionId={id} hostel={chosen} mark={can('hostel.rollcall.mark')} />
          )}
        </div>
      )}
    </div>
  );
}

function NoHostel({ institutionId, manage }: { institutionId: string; manage: boolean }) {
  const [adding, setAdding] = useState(false);
  const refresh = useRefresh();
  return (
    <>
      <EmptyState
        art="welcome"
        area="amber"
        title={t.noHostels}
        body={t.noHostelsBody}
        {...(manage
          ? {
              actions: (
                <Button onClick={() => setAdding(true)}>
                  <Plus aria-hidden className="size-4" />
                  {t.addHostel}
                </Button>
              ),
            }
          : {})}
      />
      {adding && (
        <HostelForm
          institutionId={institutionId}
          hostel={null}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Rooms and beds
// ---------------------------------------------------------------------------------------------

function Rooms({
  institutionId,
  hostel,
  hostels,
  manage,
}: {
  institutionId: string;
  hostel: HostelRow;
  hostels: HostelRow[];
  manage: boolean;
}) {
  const refresh = useRefresh();
  const [form, setForm] = useState<
    | { kind: 'hostel'; hostel: HostelRow | null }
    | { kind: 'room'; room: RoomRow | null }
    | { kind: 'allocate'; room: RoomRow; bed: number }
    | { kind: 'move'; bed: Bed }
    | { kind: 'vacate'; bed: Bed }
    | null
  >(null);
  const q = useQuery({
    queryKey: ['hostel-rooms', institutionId, hostel.id],
    queryFn: () =>
      api.get<RoomRow[]>(`/hostel/hostels/${hostel.id}/rooms?institutionId=${institutionId}`),
  });
  const done = () => {
    setForm(null);
    refresh();
  };
  return (
    <Section
      id="hostel-rooms"
      title={`${hostel.name} · ${t.kinds[hostel.kind]}`}
      description={t.hostelLine(hostel.rooms, hostel.beds, hostel.occupied)}
      flush
      actions={
        manage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForm({ kind: 'hostel', hostel })}
            >
              {t.editHostel}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setForm({ kind: 'hostel', hostel: null })}
            >
              {t.addHostel}
            </Button>
            <Button size="sm" onClick={() => setForm({ kind: 'room', room: null })}>
              <Plus aria-hidden className="size-4" />
              {t.addRoom}
            </Button>
          </div>
        ) : undefined
      }
    >
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : q.data.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{t.noRooms}</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-body font-semibold text-ink">{t.room(r.number)}</h3>
                {r.floor && (
                  <span className="text-caption text-ink-muted">{t.floorOf(r.floor)}</span>
                )}
                {!r.active && <Pill>{en.expenses.off}</Pill>}
                {manage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setForm({ kind: 'room', room: r })}
                  >
                    {t.edit}
                    <span className="sr-only"> {t.room(r.number)}</span>
                  </Button>
                )}
              </div>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {r.occupants.map((b) => (
                  <li
                    key={b.bedNo}
                    className={cx(
                      'flex items-center gap-3 rounded-lg border px-3 py-2',
                      b.studentId ? 'border-line-strong' : 'border-dashed border-line-strong',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-caption text-ink-muted">{t.bed(b.bedNo)}</span>
                      <span className="text-body text-ink">{b.name ?? t.free}</span>
                      {b.studentId && (
                        <span className="text-caption text-ink-muted">
                          {[b.label, b.since ? t.since(dmy(b.since)) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    {manage && r.active && !b.studentId && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setForm({ kind: 'allocate', room: r, bed: b.bedNo })}
                      >
                        {t.giveBed}
                        <span className="sr-only"> {t.allocateTitle(r.number, b.bedNo)}</span>
                      </Button>
                    )}
                    {manage && b.studentId && (
                      <span className="flex gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setForm({ kind: 'move', bed: b })}
                        >
                          {t.move}
                          <span className="sr-only"> {b.name}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setForm({ kind: 'vacate', bed: b })}
                        >
                          {t.vacate}
                          <span className="sr-only"> {b.name}</span>
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {form?.kind === 'hostel' && (
        <HostelForm
          institutionId={institutionId}
          hostel={form.hostel}
          onClose={() => setForm(null)}
          onDone={done}
        />
      )}
      {form?.kind === 'room' && (
        <RoomForm
          institutionId={institutionId}
          hostelId={hostel.id}
          room={form.room}
          onClose={() => setForm(null)}
          onDone={done}
        />
      )}
      {form?.kind === 'allocate' && (
        <AllocateForm
          institutionId={institutionId}
          room={form.room}
          bed={form.bed}
          onClose={() => setForm(null)}
          onDone={done}
        />
      )}
      {form?.kind === 'move' && q.data && (
        <MoveForm
          institutionId={institutionId}
          bed={form.bed}
          hostels={hostels.filter((h) => h.active)}
          current={hostel.id}
          onClose={() => setForm(null)}
          onDone={done}
        />
      )}
      {form?.kind === 'vacate' && (
        <ReasonDialog
          title={`${t.vacate}: ${form.bed.name ?? ''}`}
          hint={t.vacateHint}
          label={t.reason}
          action={t.vacate}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setForm(null)}
          submit={async (reason) => {
            await api.post(`/hostel/allocations/${form.bed.allocationId}/vacate`, {
              institutionId,
              reason,
            });
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function HostelForm({
  institutionId,
  hostel,
  onClose,
  onDone,
}: {
  institutionId: string;
  hostel: HostelRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(hostel?.name ?? '');
  const [kind, setKind] = useState(hostel?.kind ?? 'boys');
  const [active, setActive] = useState(hostel?.active ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = { institutionId, name, kind, active };
      return hostel
        ? api.put(`/hostel/hostels/${hostel.id}`, body)
        : api.post('/hostel/hostels', body);
    },
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={hostel ? t.editHostel : t.addHostel}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.hostelName}>
        <input
          className={fieldInput}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.kind}>
        <select
          className={fieldInput}
          value={kind}
          onChange={(e) => setKind(e.target.value as HostelRow['kind'])}
        >
          {(['boys', 'girls', 'mixed'] as const).map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      {hostel && (
        <label className="flex items-center gap-2 text-body text-ink sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t.active}
        </label>
      )}
    </FormModal>
  );
}

function RoomForm({
  institutionId,
  hostelId,
  room,
  onClose,
  onDone,
}: {
  institutionId: string;
  hostelId: string;
  room: RoomRow | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [number, setNumber] = useState(room?.number ?? '');
  const [floor, setFloor] = useState(room?.floor ?? '');
  const [beds, setBeds] = useState(String(room?.beds ?? 3));
  const [active, setActive] = useState(room?.active ?? true);
  const n = Number(beds);
  const save = useMutation({
    mutationFn: () => {
      const body = { institutionId, number, floor, beds: n, active };
      return room
        ? api.put(`/hostel/hostels/${hostelId}/rooms/${room.id}`, body)
        : api.post(`/hostel/hostels/${hostelId}/rooms`, body);
    },
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={room ? t.editRoom : t.addRoom}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!number.trim() || !(Number.isInteger(n) && n >= 1 && n <= 20)}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.roomNumber}>
        <input
          className={fieldInput}
          value={number}
          maxLength={20}
          onChange={(e) => setNumber(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.floor} hint={en.expenses.optional}>
        <input
          className={fieldInput}
          value={floor}
          maxLength={20}
          onChange={(e) => setFloor(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.beds}>
        <input
          className={fieldInput}
          inputMode="numeric"
          value={beds}
          onChange={(e) => setBeds(e.target.value)}
        />
      </ModalField>
      {room && (
        <label className="flex items-center gap-2 text-body text-ink sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t.active}
        </label>
      )}
    </FormModal>
  );
}

function AllocateForm({
  institutionId,
  room,
  bed,
  onClose,
  onDone,
}: {
  institutionId: string;
  room: RoomRow;
  bed: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  useEffect(() => {
    const h = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  const found = useQuery({
    queryKey: ['hostel-students', institutionId, query],
    queryFn: () =>
      api.get<Student[]>(
        `/hostel/students?institutionId=${institutionId}&text=${encodeURIComponent(query)}`,
      ),
    enabled: query.length >= 2 && !student,
  });
  const save = useMutation({
    mutationFn: () =>
      api.post('/hostel/allocations', {
        institutionId,
        roomId: room.id,
        bedNo: bed,
        studentId: student?.personId,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.allocateTitle(room.number, bed)}
      submitLabel={t.giveBed}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!student || !!student.bed}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {student ? (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-caption font-medium text-ink">{t.student}</span>
          <span className="flex items-center gap-3 rounded-lg border border-line-strong px-3 py-2">
            <span className="min-w-0 flex-1 text-body text-ink">
              {student.name}
              <span className="block text-caption text-ink-muted">
                {student.bed ? t.hasBed(student.bed) : student.label}
              </span>
            </span>
            <Button size="sm" variant="secondary" type="button" onClick={() => setStudent(null)}>
              {t.change}
            </Button>
          </span>
        </div>
      ) : (
        <>
          <ModalField label={t.student} hint={t.studentHint} wide>
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
                <li className="px-3 py-2 text-body text-ink-muted">{t.noStudents}</li>
              ) : (
                found.data.map((p) => (
                  <li key={p.personId}>
                    <button
                      type="button"
                      onClick={() => setStudent(p)}
                      className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper"
                    >
                      <span className="text-body text-ink">{p.name}</span>
                      <span className="text-caption text-ink-muted">
                        {[p.label, p.bed].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </FormModal>
  );
}

function MoveForm({
  institutionId,
  bed,
  hostels,
  current,
  onClose,
  onDone,
}: {
  institutionId: string;
  bed: Bed;
  hostels: HostelRow[];
  current: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [hostelId, setHostelId] = useState(current);
  const [target, setTarget] = useState('');
  const q = useQuery({
    queryKey: ['hostel-rooms', institutionId, hostelId],
    queryFn: () =>
      api.get<RoomRow[]>(`/hostel/hostels/${hostelId}/rooms?institutionId=${institutionId}`),
  });
  const free = (q.data ?? [])
    .filter((r) => r.active)
    .flatMap((r) =>
      r.occupants
        .filter((b) => !b.studentId)
        .map((b) => ({ roomId: r.id, room: r.number, bed: b.bedNo })),
    );
  const [roomId, bedNo] = target.split(':');
  const save = useMutation({
    mutationFn: () =>
      api.post(`/hostel/allocations/${bed.allocationId}/move`, {
        institutionId,
        roomId,
        bedNo: Number(bedNo),
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.moveTitle(bed.name ?? '')}
      submitLabel={t.move}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!target}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {hostels.length > 1 && (
        <ModalField label={t.hostel}>
          <select
            className={fieldInput}
            value={hostelId}
            onChange={(e) => {
              setHostelId(e.target.value);
              setTarget('');
            }}
          >
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </ModalField>
      )}
      <ModalField label={t.toBed}>
        <select className={fieldInput} value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="" />
          {free.map((f) => (
            <option key={`${f.roomId}:${f.bed}`} value={`${f.roomId}:${f.bed}`}>
              {`${t.room(f.room)} · ${t.bed(f.bed)}`}
            </option>
          ))}
        </select>
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Roll call
// ---------------------------------------------------------------------------------------------

function RollCall({
  institutionId,
  hostel,
  mark,
}: {
  institutionId: string;
  hostel: HostelRow;
  mark: boolean;
}) {
  const refresh = useRefresh();
  const [session, setSession] = useState<'night' | 'morning'>('night');
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const q = useQuery({
    queryKey: ['hostel-roll', institutionId, hostel.id, session],
    queryFn: () =>
      api.get<{
        onDate: string;
        takenAt: string | null;
        takenBy: string | null;
        lines: RollLine[];
      }>(
        `/hostel/hostels/${hostel.id}/roll-call?institutionId=${institutionId}&session=${session}`,
      ),
  });
  useEffect(() => {
    if (q.data)
      setMarks(
        Object.fromEntries(
          q.data.lines.filter((l) => l.status).map((l) => [l.studentId, l.status as Mark]),
        ),
      );
  }, [q.data]);
  const save = useMutation({
    mutationFn: () =>
      api.put<{ absent: number }>(`/hostel/hostels/${hostel.id}/roll-call`, {
        institutionId,
        session,
        marks: Object.entries(marks).map(([studentId, status]) => ({ studentId, status })),
      }),
    onSuccess: refresh,
  });
  const lines = q.data?.lines ?? [];
  const unmarked = lines.filter((l) => !marks[l.studentId]).length;
  return (
    <Section
      id="hostel-roll"
      title={`${t.tabs.roll} · ${hostel.name}`}
      description={q.data ? t.rollLead(dmy(q.data.onDate)) : undefined}
      flush
      actions={
        <Segmented
          label={t.session}
          value={session}
          onChange={(v) => {
            setSession(v);
            save.reset();
          }}
          options={(['night', 'morning'] as const).map((s) => ({ value: s, label: t.sessions[s] }))}
        />
      }
    >
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : lines.length === 0 ? (
        <p className="px-5 py-4 text-body text-ink-muted">{t.noResidents}</p>
      ) : (
        <>
          {q.data.takenAt && (
            <p className="px-5 pt-3 text-caption text-ink-muted">
              {t.taken(q.data.takenBy ?? '', time(q.data.takenAt))}
            </p>
          )}
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li
                key={l.studentId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body text-ink">{l.name}</span>
                  <span className="text-caption text-ink-muted">
                    {[t.room(l.room), t.bed(l.bedNo), l.label, l.outOnPass ? t.onPass : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <div role="radiogroup" aria-label={l.name} className="flex gap-1">
                  {(['present', 'absent', 'on_leave'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={marks[l.studentId] === m}
                      disabled={!mark}
                      onClick={() => setMarks((cur) => ({ ...cur, [l.studentId]: m }))}
                      className={cx(
                        'min-h-11 rounded-lg border px-3 text-caption font-medium',
                        marks[l.studentId] === m
                          ? m === 'absent'
                            ? 'border-signal-stop bg-signal-stop-tint text-signal-stop-ink'
                            : 'border-navy-950 bg-navy-50 text-navy-950'
                          : 'border-line-strong text-ink',
                      )}
                    >
                      {t.marks[m]}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {mark && (
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
              {unmarked > 0 && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    setMarks((cur) => ({
                      ...Object.fromEntries(lines.map((l) => [l.studentId, 'present' as Mark])),
                      ...cur,
                    }))
                  }
                >
                  {t.allPresent}
                </Button>
              )}
              <Button disabled={unmarked > 0 || save.isPending} onClick={() => save.mutate()}>
                {t.saveRoll}
              </Button>
              <span role="status" className="text-caption text-ink-muted">
                {save.isSuccess
                  ? t.saved(save.data.absent)
                  : unmarked > 0
                    ? t.unmarked(unmarked)
                    : ''}
              </span>
              {save.isError && (
                <p role="alert" className="text-caption text-signal-stop-ink">
                  {errorText(save.error)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Outpasses
// ---------------------------------------------------------------------------------------------

function Outpasses({ institutionId, decide }: { institutionId: string; decide: boolean }) {
  const refresh = useRefresh();
  const [view, setView] = useState<OutpassView>('requested');
  const [issuing, setIssuing] = useState(false);
  const [rejecting, setRejecting] = useState<OutpassRow | null>(null);
  const q = useQuery({
    queryKey: ['hostel-outpasses', institutionId, view],
    queryFn: () =>
      api.get<OutpassRow[]>(`/hostel/outpasses?institutionId=${institutionId}&view=${view}`),
  });
  const act = useMutation({
    mutationFn: ({ o, what }: { o: OutpassRow; what: 'approve' | 'left' | 'back' | 'cancel' }) =>
      what === 'approve'
        ? api.post(`/hostel/outpasses/${o.outpassId}/decide`, {
            institutionId,
            approve: true,
            note: '',
          })
        : what === 'cancel'
          ? api.post(`/hostel/outpasses/${o.outpassId}/cancel`)
          : api.post(`/hostel/outpasses/${o.outpassId}/${what}`, { institutionId }),
    onSuccess: refresh,
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Segmented
          label={t.viewsLabel}
          value={view}
          onChange={setView}
          options={(['requested', 'approved', 'out', 'overdue', 'recent'] as const).map((v) => ({
            value: v,
            label: t.views[v],
          }))}
        />
        {decide && (
          <Button onClick={() => setIssuing(true)}>
            <Plus aria-hidden className="size-4" />
            {t.issueOutpass}
          </Button>
        )}
      </div>
      {act.isError && (
        <p role="alert" className="text-caption text-signal-stop-ink">
          {errorText(act.error)}
        </p>
      )}
      {!q.data ? (
        <QueryState q={q} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={Hotel} area="amber" title={t.noOutpasses[view] ?? ''} />
      ) : (
        <Section id="hostel-outpasses" title={t.views[view]} flush>
          <ul className="divide-y divide-line">
            {q.data.map((o) => (
              <li
                key={o.outpassId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-2 text-body text-ink">
                    {o.student}
                    {o.label && <span className="text-caption text-ink-muted">{o.label}</span>}
                    <Pill
                      tone={
                        o.overdue
                          ? 'stop'
                          : o.state === 'requested'
                            ? 'warn'
                            : o.state === 'out' || o.state === 'returned'
                              ? 'go'
                              : 'neutral'
                      }
                    >
                      {o.overdue ? t.overdue : t.state[o.state]}
                    </Pill>
                  </span>
                  <span className="text-caption text-ink-muted tabular-nums">
                    {[
                      t.dates(dmy(o.leavesOn), dmy(o.backBy)),
                      o.room ? t.room(o.room) : null,
                      t.collects(o.collector, t.relationOf(o.relation)),
                      o.phone && !o.guardian ? o.phone.replace(/^\+91/, '') : null,
                      o.reason,
                      o.byParent
                        ? t.askedByParent(o.requestedBy ?? '')
                        : t.issuedBy(o.requestedBy ?? ''),
                      o.decisionNote,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {decide && o.state === 'requested' && (
                  <>
                    <Button
                      size="sm"
                      disabled={act.isPending}
                      onClick={() => act.mutate({ o, what: 'approve' })}
                    >
                      {t.approve}
                      <span className="sr-only"> {o.student}</span>
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setRejecting(o)}>
                      {t.reject}
                      <span className="sr-only"> {o.student}</span>
                    </Button>
                  </>
                )}
                {decide && o.state === 'approved' && (
                  <Button
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ o, what: 'left' })}
                  >
                    {t.left}
                    <span className="sr-only"> {o.student}</span>
                  </Button>
                )}
                {decide && o.state === 'out' && (
                  <Button
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ o, what: 'back' })}
                  >
                    {t.back}
                    <span className="sr-only"> {o.student}</span>
                  </Button>
                )}
                {decide && (o.state === 'requested' || o.state === 'approved') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ o, what: 'cancel' })}
                  >
                    {t.cancelOutpass}
                    <span className="sr-only"> {o.student}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {issuing && (
        <OutpassForm
          institutionId={institutionId}
          onClose={() => setIssuing(false)}
          onDone={() => {
            setIssuing(false);
            setView('approved');
            refresh();
          }}
        />
      )}
      {rejecting && (
        <ReasonDialog
          title={`${t.reject}: ${rejecting.student}`}
          hint={t.rejectHint}
          label={t.note}
          action={t.reject}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setRejecting(null)}
          submit={async (note) => {
            await api.post(`/hostel/outpasses/${rejecting.outpassId}/decide`, {
              institutionId,
              approve: false,
              note,
            });
            refresh();
          }}
        />
      )}
    </div>
  );
}

function OutpassForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [student, setStudent] = useState<Student | null>(null);
  const [leavesOn, setLeavesOn] = useState(todayIso());
  const [backBy, setBackBy] = useState(todayIso());
  const [reason, setReason] = useState('');
  const [who, setWho] = useState('');
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  const found = useQuery({
    queryKey: ['hostel-students', institutionId, query],
    queryFn: () =>
      api.get<Student[]>(
        `/hostel/students?institutionId=${institutionId}&text=${encodeURIComponent(query)}`,
      ),
    enabled: query.length >= 2 && !student,
  });
  // The child's guardians who may collect them, from the parent's view of the child.
  const pickup = useQuery({
    queryKey: ['hostel-child', student?.personId],
    queryFn: () =>
      api.get<{ collectors: { personId: string; name: string; relationship: string }[] }>(
        `/hostel/children/${student?.personId}`,
      ),
    enabled: !!student,
  });
  const other = who === 'other';
  const digits = mobile(phone);
  const save = useMutation({
    mutationFn: () =>
      api.post('/hostel/outpasses', {
        institutionId,
        studentId: student?.personId,
        leavesOn,
        backBy,
        reason,
        collector: other ? { name, relation, phone: digits } : { guardianId: who },
      }),
    onSuccess: onDone,
  });
  const ready =
    !!student &&
    !!leavesOn &&
    backBy >= leavesOn &&
    reason.trim().length >= 3 &&
    (other ? !!name.trim() && !!relation.trim() && !!digits : !!who);
  const options = [
    ...(pickup.data?.collectors ?? []).map((g) => ({
      value: g.personId,
      label: g.name,
      hint: t.relationOf(g.relationship),
    })),
    { value: 'other', label: t.someoneElse, hint: '' },
  ];
  return (
    <FormModal
      title={t.issueTitle}
      submitLabel={t.issueOutpass}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!ready}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {student ? (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-caption font-medium text-ink">{t.student}</span>
          <span className="flex items-center gap-3 rounded-lg border border-line-strong px-3 py-2">
            <span className="min-w-0 flex-1 text-body text-ink">
              {student.name}
              <span className="block text-caption text-ink-muted">
                {[student.label, student.bed].filter(Boolean).join(' · ')}
              </span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              type="button"
              onClick={() => {
                setStudent(null);
                setWho('');
              }}
            >
              {t.change}
            </Button>
          </span>
        </div>
      ) : (
        <>
          <ModalField label={t.student} hint={t.studentHint} wide>
            <input
              className={fieldInput}
              value={text}
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
            />
          </ModalField>
          {query.length >= 2 && found.data && (
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line sm:col-span-2">
              {found.data.filter((p) => p.bed).length === 0 ? (
                <li className="px-3 py-2 text-body text-ink-muted">{t.noStudents}</li>
              ) : (
                found.data
                  .filter((p) => p.bed)
                  .map((p) => (
                    <li key={p.personId}>
                      <button
                        type="button"
                        onClick={() => setStudent(p)}
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper"
                      >
                        <span className="text-body text-ink">{p.name}</span>
                        <span className="text-caption text-ink-muted">
                          {[p.label, p.bed].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))
              )}
            </ul>
          )}
        </>
      )}
      <ModalField label={t.leavesOn}>
        <input
          type="date"
          className={fieldInput}
          value={leavesOn}
          min={todayIso()}
          onChange={(e) => setLeavesOn(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.backBy}>
        <input
          type="date"
          className={fieldInput}
          value={backBy}
          min={leavesOn}
          onChange={(e) => setBackBy(e.target.value)}
        />
      </ModalField>
      {student && pickup.data && (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1.5 text-caption font-medium text-ink">{t.collector}</legend>
          {pickup.data.collectors.length === 0 && (
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
      <ModalField label={t.reason} wide>
        <input
          className={fieldInput}
          value={reason}
          maxLength={300}
          onChange={(e) => setReason(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}
