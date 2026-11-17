'use client';

import type {
  Clash,
  Generation,
  Group,
  Rules,
  TimetableDetail,
  Version,
} from '@campusverse/school-timetable';
import { Button, FormModal, ModalField, PreviewCanvas, SkeletonRows } from '@campusverse/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { en } from '../../../messages/en';
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

/** A new timetable (institutionId), or a draft's bell schedule and days (detail). */
export function ScheduleForm(
  props: { onClose: () => void; onDone: (id?: string) => void } & (
    | { institutionId: string; detail?: undefined }
    | { detail: TimetableDetail; institutionId?: undefined }
  ),
) {
  const d = props.detail;
  const [name, setName] = useState(d?.version.name ?? '');
  const [days, setDays] = useState<number[]>(d?.version.days ?? [1, 2, 3, 4, 5, 6]);
  const [rows, setRows] = useState<Row[]>(
    d ? d.periods.map((p) => ({ ...p, label: p.label ?? '' })) : TEMPLATE,
  );
  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        days,
        periods: rows.map((r) => ({ ...r, label: r.label.trim() || null })),
      };
      if (d) {
        await api.put(`/school/timetable/${d.version.id}/schedule`, body);
        return undefined;
      }
      return (
        await api.post<{ id: string }>('/school/timetable', {
          ...body,
          institutionId: props.institutionId,
        })
      ).id;
    },
    onSuccess: (id) => props.onDone(id),
  });
  const set = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <FormModal
      title={d ? t.schedule : t.new}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim() || days.length === 0 || rows.length === 0}
      error={save.error ? errorText(save.error) : null}
      size="xl"
      onClose={props.onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.name} hint={t.nameHint}>
        <input className={fieldInput} value={name} onChange={(e) => setName(e.target.value)} />
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
                  setDays((x) => (e.target.checked ? [...x, n].sort() : x.filter((y) => y !== n)))
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

const gen = t.generate;

/**
 * Generating: the rules (saved with the draft), then the worker's result as a preview, then
 * "Place" writes exactly that.
 */
export function GenerateCanvas({
  detail,
  onClose,
  onDone,
}: {
  detail: TimetableDetail;
  onClose: () => void;
  onDone: (n: number) => void;
}) {
  const id = detail.version.id;
  const [rules, setRules] = useState<Rules>(detail.rules);
  const [runId, setRunId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/school/timetable/${id}/generate`, { rules }),
    onSuccess: (r) => setRunId(r.id),
  });
  const run = useQuery({
    queryKey: ['timetable-generation', runId],
    queryFn: () => api.get<Generation>(`/school/timetable/${id}/generate/${runId}`),
    enabled: !!runId,
    refetchInterval: (q) => (q.state.data?.state === 'working' ? 1000 : false),
  });
  const place = useMutation({
    mutationFn: () =>
      api.post<{ placed: number }>(`/school/timetable/${id}/generate/${runId}/place`),
    onSuccess: (r) => onDone(r.placed),
  });
  const { plan, staff, periods, version } = detail;
  const section = new Map(plan.sections.map((x) => [x.sectionId, x.label]));
  const subject = new Map(plan.offerings.map((o) => [o.subjectId, o]));
  const name = new Map(staff.map((x) => [x.personId, x.name]));
  const ordinal = new Map(periods.map((p) => [p.number, p.ordinal ?? p.number]));

  const r = run.data?.state === 'ready' ? run.data.result : null;
  if (run.data && r) {
    const missing = r.short.reduce((n, x) => n + x.missing, 0);
    return (
      <PreviewCanvas
        open
        onOpenChange={(o) => !o && onClose()}
        title={gen.title}
        actionLabel={gen.action(r.placed.length)}
        changes={
          r.placed.length === 0
            ? [gen.nothing]
            : [...r.placed]
                .sort(
                  (a, b) =>
                    (section.get(a.sectionId) ?? '').localeCompare(
                      section.get(b.sectionId) ?? '',
                    ) ||
                    a.weekday - b.weekday ||
                    a.period - b.period,
                )
                .map((l) =>
                  gen.change(
                    section.get(l.sectionId) ?? '',
                    t.days[l.weekday] ?? '',
                    ordinal.get(l.period) ?? l.period,
                    subject.get(l.subjectId)?.name ?? '',
                    l.teacherPersonId ? (name.get(l.teacherPersonId) ?? '') : '',
                    l.room ?? '',
                  ),
                )
        }
        affected={[
          { label: gen.placed, count: r.placed.length },
          { label: gen.short, count: missing },
          { label: gen.noTeacher, count: r.noTeacher },
        ]}
        risks={[
          ...(r.complete ? [gen.complete] : []),
          ...(r.timeWish.of ? [gen.timeWish(r.timeWish.met, r.timeWish.of)] : []),
          ...(r.mode === 'rebuild' && r.replaces ? [gen.replaces(r.replaces)] : []),
          ...r.short.map((x) =>
            gen.shortRisk(
              section.get(x.sectionId) ?? '',
              subject.get(x.subjectId)?.name ?? '',
              x.missing,
            ),
          ),
          ...(r.noTeacher ? [gen.noTeacherRisk(r.noTeacher)] : []),
          ...(run.data.stale ? [String(t.errors.changed)] : []),
          ...(place.isError ? [errorText(place.error)] : []),
        ]}
        undo={gen.undo}
        busy={place.isPending}
        onConfirm={() => r.placed.length > 0 && place.mutate()}
        labels={en.preview}
      />
    );
  }

  const working = start.isPending || run.data?.state === 'working' || (!!runId && run.isPending);
  const subjects = [...new Map(plan.offerings.map((o) => [o.subjectId, o])).values()].filter(
    (o) => o.periodsPerWeek,
  );
  const teacherIds = [...new Set(plan.teachers.map((x) => x.personId))];
  const classPeriods = periods.flatMap((p) => (p.ordinal ? [p.ordinal] : []));
  const sub = (sid: string, patch: Partial<Rules['subjects'][string]>) =>
    setRules((x) => ({
      ...x,
      subjects: { ...x.subjects, [sid]: { ...x.subjects[sid], ...patch } },
    }));
  const tea = (pid: string, patch: Partial<Rules['teachers'][string]>) =>
    setRules((x) => ({
      ...x,
      teachers: { ...x.teachers, [pid]: { ...x.teachers[pid], ...patch } },
    }));
  const num = (v: string) => (v ? Number(v) : undefined);
  const select = 'h-9 rounded-lg border border-line bg-surface px-2 text-body text-ink';
  return (
    <FormModal
      title={gen.title}
      description={gen.lead}
      submitLabel={gen.run}
      cancelLabel={t.cancel}
      pending={working}
      error={
        run.data?.state === 'failed'
          ? gen.failed
          : start.error
            ? errorText(start.error)
            : run.error
              ? errorText(run.error)
              : null
      }
      size="lg"
      onClose={onClose}
      onSubmit={() => {
        setRunId(null);
        start.mutate();
      }}
    >
      {working ? (
        <div className="col-span-full flex flex-col gap-2" role="status">
          <p className="font-medium text-ink">{gen.working}</p>
          <p className="text-caption text-ink-muted">{gen.workingBody}</p>
          <SkeletonRows rows={3} label={gen.working} />
        </div>
      ) : (
        <>
          <fieldset className="col-span-full flex flex-col gap-2">
            <legend className="mb-1 text-caption font-medium text-ink">{gen.how}</legend>
            {(['fill', 'rebuild'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2 text-body text-ink">
                <input
                  type="radio"
                  name="mode"
                  checked={rules.mode === m}
                  onChange={() => setRules((x) => ({ ...x, mode: m }))}
                />
                {gen.modes[m]}
              </label>
            ))}
          </fieldset>
          <ModalField label={gen.maxSame}>
            <select
              className={fieldInput}
              value={rules.maxSamePerDay}
              onChange={(e) => setRules((x) => ({ ...x, maxSamePerDay: Number(e.target.value) }))}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {gen.times(n)}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label={gen.teacherMax}>
            <input
              type="number"
              min={1}
              max={16}
              className={fieldInput}
              value={rules.teacherMaxPerDay}
              onChange={(e) =>
                setRules((x) => ({ ...x, teacherMaxPerDay: Number(e.target.value) || 1 }))
              }
            />
          </ModalField>
          <ModalField label={gen.teacherRow}>
            <input
              type="number"
              min={1}
              max={16}
              className={fieldInput}
              value={rules.teacherMaxInARow}
              onChange={(e) =>
                setRules((x) => ({ ...x, teacherMaxInARow: Number(e.target.value) || 1 }))
              }
            />
          </ModalField>

          {subjects.length > 0 && (
            <details className="col-span-full rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 font-medium text-ink">
                {gen.subjects}
              </summary>
              <p className="px-3 text-caption text-ink-muted">{gen.subjectsHint}</p>
              <p className="px-3 pt-1 text-caption text-ink-muted">{gen.roomsHint}</p>
              <div className="overflow-x-auto p-3">
                <table className="w-full min-w-[480px] text-body">
                  <thead>
                    <tr className="text-left text-caption text-ink-muted">
                      <th className="py-1 pr-2 font-medium">{gen.subjects}</th>
                      <th className="py-1 pr-2 font-medium">{gen.doubles}</th>
                      <th className="py-1 pr-2 font-medium">{gen.time}</th>
                      <th className="py-1 pr-2 font-medium">{gen.subjectMax}</th>
                      <th className="py-1 font-medium">{gen.rooms}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((o) => {
                      const v = rules.subjects[o.subjectId] ?? {};
                      return (
                        <tr key={o.subjectId}>
                          <th scope="row" className="py-1 pr-2 text-left font-normal text-ink">
                            {o.code} · {o.name}
                          </th>
                          <td className="py-1 pr-2">
                            <select
                              aria-label={`${gen.doubles}: ${o.name}`}
                              className={select}
                              value={v.doubles ?? 0}
                              onChange={(e) =>
                                sub(o.subjectId, { doubles: Number(e.target.value) })
                              }
                            >
                              {[0, 1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 pr-2">
                            <select
                              aria-label={`${gen.time}: ${o.name}`}
                              className={select}
                              value={v.time ?? 'any'}
                              onChange={(e) =>
                                sub(o.subjectId, {
                                  time: e.target.value as 'any' | 'morning' | 'afternoon',
                                })
                              }
                            >
                              {(['any', 'morning', 'afternoon'] as const).map((x) => (
                                <option key={x} value={x}>
                                  {gen.timeOf[x]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1 pr-2">
                            <select
                              aria-label={`${gen.subjectMax}: ${o.name}`}
                              className={select}
                              value={v.maxPerDay ?? ''}
                              onChange={(e) => sub(o.subjectId, { maxPerDay: num(e.target.value) })}
                            >
                              <option value="">{gen.schoolRule}</option>
                              {[1, 2, 3, 4].map((n) => (
                                <option key={n} value={n}>
                                  {gen.times(n)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-1">
                            <RoomsInput
                              label={`${gen.rooms}: ${o.name}`}
                              value={v.rooms ?? []}
                              onChange={(rooms) => sub(o.subjectId, { rooms })}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {teacherIds.length > 0 && (
            <details className="col-span-full rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 font-medium text-ink">
                {gen.teachers}
              </summary>
              <p className="px-3 text-caption text-ink-muted">{gen.teachersHint}</p>
              <ul className="flex flex-col divide-y divide-line p-3">
                {teacherIds.map((pid) => {
                  const v = rules.teachers[pid] ?? {};
                  const who = name.get(pid) ?? '';
                  return (
                    <li key={pid} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2">
                      <span className="min-w-40 font-medium text-ink">{who}</span>
                      <span className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                        {gen.offDays}
                        {version.days.map((d) => (
                          <label key={d} className="flex items-center gap-1 text-body text-ink">
                            <input
                              type="checkbox"
                              checked={!!v.offDays?.includes(d)}
                              onChange={(e) =>
                                tea(pid, {
                                  offDays: e.target.checked
                                    ? [...(v.offDays ?? []), d]
                                    : (v.offDays ?? []).filter((x) => x !== d),
                                })
                              }
                            />
                            <span className="sr-only">{gen.offDayFor(who)}</span>
                            {t.daysShort[d]}
                          </label>
                        ))}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-caption text-ink-muted">
                        {gen.offPeriods}
                        {classPeriods.map((n) => (
                          <label key={n} className="flex items-center gap-1 text-body text-ink">
                            <input
                              type="checkbox"
                              checked={!!v.offPeriods?.includes(n)}
                              onChange={(e) =>
                                tea(pid, {
                                  offPeriods: e.target.checked
                                    ? [...(v.offPeriods ?? []), n]
                                    : (v.offPeriods ?? []).filter((x) => x !== n),
                                })
                              }
                            />
                            <span className="sr-only">{gen.offPeriodFor(who)}</span>
                            {`P${n}`}
                          </label>
                        ))}
                      </span>
                      <label className="flex items-center gap-2 text-caption text-ink-muted">
                        {gen.teacherOwnMax}
                        <select
                          className={select}
                          value={v.maxPerDay ?? ''}
                          onChange={(e) => tea(pid, { maxPerDay: num(e.target.value) })}
                        >
                          <option value="">{gen.schoolRule}</option>
                          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </label>
                      <details className="w-full rounded-lg bg-paper">
                        <summary className="cursor-pointer px-2 py-1 text-caption text-ink-muted">
                          {gen.offTimes} · {gen.offTimesCount(v.offCells?.length ?? 0)}
                        </summary>
                        <div className="overflow-x-auto p-2">
                          <table className="text-caption">
                            <thead>
                              <tr>
                                <th className="px-1">
                                  <span className="sr-only">{t.periods}</span>
                                </th>
                                {version.days.map((d) => (
                                  <th
                                    key={d}
                                    scope="col"
                                    className="px-1 font-medium text-ink-muted"
                                  >
                                    {t.daysShort[d]}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {classPeriods.map((n) => (
                                <tr key={n}>
                                  <th
                                    scope="row"
                                    className="px-1 text-left font-medium text-ink-muted"
                                  >
                                    {`P${n}`}
                                  </th>
                                  {version.days.map((d) => {
                                    const key = `${d}:${n}`;
                                    return (
                                      <td key={d} className="px-1 text-center">
                                        <label>
                                          <input
                                            type="checkbox"
                                            checked={!!v.offCells?.includes(key)}
                                            onChange={(e) =>
                                              tea(pid, {
                                                offCells: e.target.checked
                                                  ? [...(v.offCells ?? []), key]
                                                  : (v.offCells ?? []).filter((x) => x !== key),
                                              })
                                            }
                                          />
                                          <span className="sr-only">
                                            {gen.offCellFor(who, t.days[d] ?? '', n)}
                                          </span>
                                        </label>
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </FormModal>
  );
}

/** Rooms as typed ("Lab 1, Lab 2"), kept as text while typing and split on leaving the field. */
function RoomsInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string[];
  onChange: (rooms: string[]) => void;
}) {
  const [text, setText] = useState(value.join(', '));
  return (
    <input
      aria-label={label}
      className="h-9 w-40 rounded-lg border border-line bg-surface px-2 text-body text-ink"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() =>
        onChange(
          [
            ...new Set(
              text
                .split(',')
                .map((r) => r.trim())
                .filter(Boolean),
            ),
          ].slice(0, 10),
        )
      }
    />
  );
}
