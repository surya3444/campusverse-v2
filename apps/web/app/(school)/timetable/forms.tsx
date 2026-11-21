'use client';

import type { Clash, Group, TimetableDetail, Version } from '@campusverse/school-timetable';
import { Button, FormModal, ModalField } from '@campusverse/ui';
import { useMutation } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { fieldInput } from '../common/custom-fields';
import { errorText, t } from './shared';

type Row = { startsAt: string; endsAt: string; kind: 'class' | 'break'; label: string };

/** A usual Indian school day: eight 40-minute periods, a short break and lunch. */
const TEMPLATE: Row[] = [
  ['08:00', '08:40'],
  ['08:40', '09:20'],
  ['09:20', '10:00'],
  ['10:00', '10:20', 'Short break'],
  ['10:20', '11:00'],
  ['11:00', '11:40'],
  ['11:40', '12:20'],
  ['12:20', '13:00', 'Lunch'],
  ['13:00', '13:40'],
  ['13:40', '14:20'],
].map(([startsAt = '', endsAt = '', label]) => ({
  startsAt,
  endsAt,
  kind: label ? 'break' : 'class',
  label: label ?? '',
}));

const plus = (hm: string, m: number) => {
  const [h = 0, mm = 0] = hm.split(':').map(Number);
  const x = Math.min(h * 60 + mm + m, 23 * 60 + 59);
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};

export type Schedule = { name: string; days: number[]; rows: Row[] };

/** A draft's schedule as the form edits it, or a usual school day for a new timetable. */
export function scheduleOf(d?: TimetableDetail | null): Schedule {
  return d
    ? {
        name: d.version.name,
        days: d.version.days,
        rows: d.periods.map((p) => ({
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          kind: p.kind,
          label: p.label ?? '',
        })),
      }
    : { name: '', days: [1, 2, 3, 4, 5, 6], rows: TEMPLATE };
}

/** What the API takes for a schedule. */
export const scheduleBody = (s: Schedule) => ({
  name: s.name,
  days: s.days,
  periods: s.rows.map((r) => ({ ...r, label: r.label.trim() || null })),
});

export const scheduleReady = (s: Schedule) =>
  !!s.name.trim() && s.days.length > 0 && s.rows.some((r) => r.kind === 'class');

/** The school day: its name, working days, and periods and breaks in order. */
export function ScheduleFields({
  value,
  onChange,
}: {
  value: Schedule;
  onChange: (next: Schedule) => void;
}) {
  const { name, days, rows } = value;
  const setRows = (f: (r: Row[]) => Row[]) => onChange({ ...value, rows: f(rows) });
  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <>
      <ModalField label={t.name} hint={t.nameHint}>
        <input
          className={fieldInput}
          value={name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </ModalField>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-caption font-medium text-ink">{t.workingDays}</legend>
        <div className="flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5, 6, 7].map((n) => (
            <label
              key={n}
              className="flex min-h-10 items-center gap-1.5 rounded-lg border border-line px-2.5 text-body text-ink"
            >
              <input
                type="checkbox"
                checked={days.includes(n)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    days: e.target.checked ? [...days, n].sort() : days.filter((y) => y !== n),
                  })
                }
              />
              {t.daysShort[n]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="col-span-full flex flex-col gap-2">
        <legend className="mb-1 text-caption font-medium text-ink">{t.periods}</legend>
        <ol className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <li
              key={i}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[110px_110px_auto_minmax(0,1fr)_auto]"
            >
              <label className="flex flex-col gap-1 text-caption text-ink-muted">
                {t.starts}
                <input
                  type="time"
                  className={fieldInput}
                  value={r.startsAt}
                  onChange={(e) => set(i, { startsAt: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1 text-caption text-ink-muted">
                {t.ends}
                <input
                  type="time"
                  className={fieldInput}
                  value={r.endsAt}
                  onChange={(e) => set(i, { endsAt: e.target.value })}
                />
              </label>
              <label className="flex h-10 items-center gap-1.5 text-body text-ink">
                <input
                  type="checkbox"
                  checked={r.kind === 'break'}
                  onChange={(e) => set(i, { kind: e.target.checked ? 'break' : 'class' })}
                />
                {t.isBreak}
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-caption text-ink-muted sm:col-span-1">
                {t.label}
                <input
                  className={fieldInput}
                  value={r.label}
                  onChange={(e) => set(i, { label: e.target.value })}
                />
              </label>
              <button
                type="button"
                aria-label={t.removePeriod(i + 1)}
                onClick={() => setRows((x) => x.filter((_, j) => j !== i))}
                className="flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-navy-50 hover:text-navy-950"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={() =>
            setRows((x) => {
              const last = x.at(-1)?.endsAt ?? '08:00';
              return [...x, { startsAt: last, endsAt: plus(last, 40), kind: 'class', label: '' }];
            })
          }
          className="inline-flex items-center gap-1.5 self-start rounded-lg px-3 py-1.5 text-body font-medium text-navy-950 hover:bg-navy-50"
        >
          <Plus aria-hidden className="size-4" />
          {t.addPeriod}
        </button>
      </fieldset>
    </>
  );
}

/** A new timetable (institutionId), or a draft's bell schedule and days (detail). */
export function ScheduleForm(
  props: { onClose: () => void; onDone: (id?: string) => void; title?: string } & (
    | { institutionId: string; detail?: undefined }
    | { detail: TimetableDetail; institutionId?: undefined }
  ),
) {
  const d = props.detail;
  const [value, setValue] = useState<Schedule>(() => scheduleOf(d));
  const save = useMutation({
    mutationFn: async () => {
      if (d) {
        await api.put(`/school/timetable/${d.version.id}/schedule`, scheduleBody(value));
        return undefined;
      }
      return (
        await api.post<{ id: string }>('/school/timetable', {
          ...scheduleBody(value),
          institutionId: props.institutionId,
        })
      ).id;
    },
    onSuccess: (id) => props.onDone(id),
  });
  return (
    <FormModal
      title={props.title ?? (d ? t.schedule : t.new)}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!scheduleReady(value)}
      error={save.error ? errorText(save.error) : null}
      size="xl"
      onClose={props.onClose}
      onSubmit={() => save.mutate()}
    >
      <ScheduleFields value={value} onChange={setValue} />
    </FormModal>
  );
}

export function CopyForm({
  version,
  onClose,
  onDone,
}: {
  version: Version;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [name, setName] = useState(`${version.name} (changes)`);
  const copy = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/school/timetable/${version.id}/copy`, { name }),
    onSuccess: (r) => onDone(r.id),
  });
  return (
    <FormModal
      title={t.copy}
      description={t.copyHint}
      submitLabel={t.copy}
      cancelLabel={t.cancel}
      pending={copy.isPending}
      submitDisabled={!name.trim()}
      error={copy.error ? errorText(copy.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => copy.mutate()}
    >
      <ModalField label={t.copyName} wide>
        <input className={fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
      </ModalField>
    </FormModal>
  );
}

export function PublishForm({
  version,
  onClose,
  onDone,
}: {
  version: Version;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const [from, setFrom] = useState(today);
  const publish = useMutation({
    mutationFn: () => api.post(`/school/timetable/${version.id}/publish`, { effectiveFrom: from }),
    onSuccess: onDone,
  });
  const clashes =
    publish.error instanceof ApiFailure && publish.error.code === 'clash_elsewhere'
      ? ((publish.error.details as { clashes?: Clash[] } | null)?.clashes ?? [])
      : [];
  return (
    <FormModal
      title={t.publishTitle(version.name)}
      description={t.publishBody}
      submitLabel={t.publish}
      cancelLabel={t.cancel}
      pending={publish.isPending}
      submitDisabled={!from}
      error={publish.error && clashes.length === 0 ? errorText(publish.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => publish.mutate()}
    >
      <ModalField label={t.from}>
        <input
          type="date"
          className={fieldInput}
          min={today}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </ModalField>
      {clashes.length > 0 && (
        <div
          role="alert"
          className="col-span-full rounded-lg bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
        >
          <p className="font-medium">{t.clashes}</p>
          <ul className="mt-1 list-disc pl-5">
            {clashes.map((c, i) => (
              <li key={i}>{t.clash(c.teacher, t.days[c.weekday] ?? '', c.period, c.school)}</li>
            ))}
          </ul>
        </div>
      )}
    </FormModal>
  );
}

/** One cell of a draft: subject (from the class's subjects), teacher, room; or a free period. */
export function SlotForm({
  detail,
  cell,
  onClose,
  onDone,
  onGroup,
}: {
  detail: TimetableDetail;
  cell: { sectionId: string; weekday: number; period: number };
  onClose: () => void;
  onDone: () => void;
  /** Present when the section is in a teaching group: place the group here instead. */
  onGroup?: (() => void) | undefined;
}) {
  const { plan, slots, staff, periods } = detail;
  const section = plan.sections.find((s) => s.sectionId === cell.sectionId);
  const offered = plan.offerings.filter((o) => o.classId === section?.classId);
  const current = slots.find(
    (s) => s.sectionId === cell.sectionId && s.weekday === cell.weekday && s.period === cell.period,
  );
  const usual = (subjectId: string) =>
    plan.teachers.find((x) => x.sectionId === cell.sectionId && x.subjectId === subjectId)
      ?.personId ?? '';
  const [subjectId, setSubjectId] = useState(current?.subjectId ?? '');
  const [teacher, setTeacher] = useState(current?.teacherPersonId ?? '');
  const [room, setRoom] = useState(current?.room ?? '');
  const save = useMutation({
    mutationFn: () =>
      api.put(`/school/timetable/${detail.version.id}/slots`, {
        ...cell,
        subjectId: subjectId || null,
        teacherPersonId: subjectId && teacher ? teacher : null,
        room: subjectId && room.trim() ? room.trim() : null,
      }),
    onSuccess: onDone,
  });
  const p = periods.find((x) => x.number === cell.period);
  const usualId = subjectId ? usual(subjectId) : '';
  return (
    <FormModal
      title={t.cellTitle(
        section?.label ?? '',
        t.days[cell.weekday] ?? '',
        p?.ordinal ?? cell.period,
        `${p?.startsAt}–${p?.endsAt}`,
      )}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {onGroup && (
        <div className="col-span-full">
          <Button type="button" variant="secondary" size="sm" onClick={onGroup}>
            {g.placeHere}
          </Button>
        </div>
      )}
      {offered.length === 0 ? (
        <p className="col-span-full text-body text-ink-muted">{t.noOfferings}</p>
      ) : (
        <>
          <ModalField label={t.subject} wide>
            <select
              className={fieldInput}
              value={subjectId}
              onChange={(e) => {
                setSubjectId(e.target.value);
                // The section's subject teacher, unless someone was already chosen for this cell.
                if (!current || current.subjectId !== e.target.value)
                  setTeacher(usual(e.target.value));
              }}
            >
              <option value="">{t.noSubject}</option>
              {offered.map((o) => (
                <option key={o.subjectId} value={o.subjectId}>
                  {o.code} · {o.name}
                </option>
              ))}
            </select>
          </ModalField>
          {subjectId && (
            <>
              <ModalField label={t.teacherFor} wide>
                <select
                  className={fieldInput}
                  value={teacher}
                  onChange={(e) => setTeacher(e.target.value)}
                >
                  <option value="">{t.noTeacher}</option>
                  {staff.map((s) => (
                    <option key={s.personId} value={s.personId}>
                      {s.personId === usualId ? t.usual(s.name) : s.name}
                    </option>
                  ))}
                </select>
              </ModalField>
              <ModalField label={t.room} hint={t.roomHint} wide>
                <input
                  className={fieldInput}
                  value={room}
                  onChange={(e) => setRoom(e.target.value)}
                />
              </ModalField>
            </>
          )}
        </>
      )}
    </FormModal>
  );
}

const g = t.groups;

/** A new teaching group, or a change to one: its name and sections. */
export function GroupForm({
  detail,
  group,
  onClose,
  onDone,
}: {
  detail: TimetableDetail;
  group?: Group | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(group?.name ?? '');
  const [sections, setSections] = useState<string[]>(group?.sectionIds ?? []);
  const base = `/school/timetable/${detail.version.id}/groups`;
  const save = useMutation({
    mutationFn: () =>
      group
        ? api.put(`${base}/${group.id}`, { name, sectionIds: sections })
        : api.post(base, { name, sectionIds: sections }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={group ? g.editName(group.name) : g.new}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim() || sections.length === 0}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={g.name} hint={g.nameHint} wide>
        <input className={fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
      </ModalField>
      <fieldset className="col-span-full flex flex-col gap-2">
        <legend className="mb-1 text-caption font-medium text-ink">{g.sections}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {detail.plan.sections.map((x) => (
            <label key={x.sectionId} className="flex items-center gap-2 text-body text-ink">
              <input
                type="checkbox"
                checked={sections.includes(x.sectionId)}
                onChange={(e) =>
                  setSections((cur) =>
                    e.target.checked
                      ? [...cur, x.sectionId]
                      : cur.filter((id) => id !== x.sectionId),
                  )
                }
              />
              {x.label}
            </label>
          ))}
        </div>
      </fieldset>
    </FormModal>
  );
}

type GroupLesson = { subjectId: string; teacher: string; room: string };

/** A teaching group in one day and period: each subject it splits into, teacher and room. */
export function GroupSlotForm({
  detail,
  cell,
  onClose,
  onDone,
}: {
  detail: TimetableDetail;
  cell: { groupId: string | null; sectionId: string; weekday: number; period: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const { plan, slots, staff, periods, groups } = detail;
  const mine = groups.filter((x) => x.sectionIds.includes(cell.sectionId));
  const [groupId, setGroupId] = useState(
    cell.groupId ?? (mine.length === 1 ? (mine[0]?.id ?? '') : ''),
  );
  const group = groups.find((x) => x.id === groupId);
  const classes = new Set(
    plan.sections.filter((x) => group?.sectionIds.includes(x.sectionId)).map((x) => x.classId),
  );
  const offered = [
    ...new Map(
      plan.offerings.filter((o) => classes.has(o.classId)).map((o) => [o.subjectId, o]),
    ).values(),
  ];
  const placedHere = (id: string) =>
    slots
      .filter((x) => x.groupId === id && x.weekday === cell.weekday && x.period === cell.period)
      .map((x) => ({
        subjectId: x.subjectId,
        teacher: x.teacherPersonId ?? '',
        room: x.room ?? '',
      }));
  // Elsewhere in the week: the group's usual subjects and teachers, to start from.
  const usual = (id: string) => {
    const any = slots.find((x) => x.groupId === id);
    return any
      ? slots
          .filter((x) => x.groupId === id && x.weekday === any.weekday && x.period === any.period)
          .map((x) => ({
            subjectId: x.subjectId,
            teacher: x.teacherPersonId ?? '',
            room: x.room ?? '',
          }))
      : [];
  };
  const start = (id: string): GroupLesson[] => {
    const here = placedHere(id);
    if (here.length) return here;
    const u = usual(id);
    return u.length ? u : [{ subjectId: '', teacher: '', room: '' }];
  };
  const [rows, setRows] = useState<GroupLesson[]>(groupId ? start(groupId) : []);
  const save = useMutation({
    mutationFn: () =>
      api.put(`/school/timetable/${detail.version.id}/groups/${groupId}/slots`, {
        weekday: cell.weekday,
        period: cell.period,
        lessons: rows
          .filter((r) => r.subjectId)
          .map((r) => ({
            subjectId: r.subjectId,
            teacherPersonId: r.teacher || null,
            room: r.room.trim() || null,
          })),
      }),
    onSuccess: onDone,
  });
  const set = (i: number, patch: Partial<GroupLesson>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const p = periods.find((x) => x.number === cell.period);
  return (
    <FormModal
      title={t.cellTitle(
        group?.name ?? plan.sections.find((x) => x.sectionId === cell.sectionId)?.label ?? '',
        t.days[cell.weekday] ?? '',
        p?.ordinal ?? cell.period,
        `${p?.startsAt}–${p?.endsAt}`,
      )}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!groupId}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {!cell.groupId && (
        <ModalField label={g.group} wide>
          <select
            className={fieldInput}
            value={groupId}
            onChange={(e) => {
              setGroupId(e.target.value);
              setRows(e.target.value ? start(e.target.value) : []);
            }}
          >
            <option value="">{g.chooseGroup}</option>
            {mine.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </ModalField>
      )}
      {group && (
        <fieldset className="col-span-full flex flex-col gap-3">
          <legend className="mb-1 text-caption font-medium text-ink">{g.subjects}</legend>
          {rows.map((r, i) => (
            <div
              key={i}
              className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto]"
            >
              <label className="flex flex-col gap-1 text-caption text-ink-muted">
                {g.subjectN(i + 1)}
                <select
                  className={fieldInput}
                  value={r.subjectId}
                  onChange={(e) => set(i, { subjectId: e.target.value })}
                >
                  <option value="">{t.noSubject}</option>
                  {offered.map((o) => (
                    <option key={o.subjectId} value={o.subjectId}>
                      {o.code} · {o.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-caption text-ink-muted">
                {t.teacherFor}
                <select
                  className={fieldInput}
                  value={r.teacher}
                  onChange={(e) => set(i, { teacher: e.target.value })}
                >
                  <option value="">{t.noTeacher}</option>
                  {staff.map((s) => (
                    <option key={s.personId} value={s.personId}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-caption text-ink-muted">
                {t.room}
                <input
                  className={fieldInput}
                  value={r.room}
                  onChange={(e) => set(i, { room: e.target.value })}
                />
              </label>
              <Button
                type="button"
                variant="quiet"
                size="sm"
                onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}
              >
                <X aria-hidden className="size-4" />
                <span className="sr-only">{g.removeSubject(i + 1)}</span>
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setRows((cur) => [...cur, { subjectId: '', teacher: '', room: '' }])}
            >
              <Plus aria-hidden className="size-3.5" />
              {g.addSubject}
            </Button>
          </div>
        </fieldset>
      )}
    </FormModal>
  );
}
