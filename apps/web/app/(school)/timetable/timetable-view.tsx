'use client';

// The school timetable: pick a version (in use, from a later date, draft, past), then see one
// section's week or one teacher's week. In a draft, each cell opens a modal; clashes come back
// from the server naming the other section. Published versions are read-only.
import type { Group, Slot, TimetableDetail, Version } from '@campusverse/school-timetable';
import {
  Announcer,
  Button,
  EmptyState,
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
import { CalendarClock, Copy, Plus, Send, Settings2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { useMe } from '../common/me';
import { CoverTab } from './cover-tab';
import {
  CopyForm,
  GenerateCanvas,
  GroupForm,
  GroupSlotForm,
  PublishForm,
  ScheduleForm,
  SlotForm,
} from './forms';
import { date, errorText, t } from './shared';

const TONE: Record<Version['status'], Tone> = {
  draft: 'warn',
  scheduled: 'neutral',
  current: 'go',
  superseded: 'neutral',
};
export const statusText = (v: Version) =>
  v.status === 'scheduled' ? t.status.scheduled(date(v.effectiveFrom ?? '')) : t.status[v.status];

type Open =
  | { kind: 'new' }
  | { kind: 'schedule' }
  | { kind: 'copy' }
  | { kind: 'publish' }
  | { kind: 'slot'; sectionId: string; weekday: number; period: number }
  | {
      kind: 'groupSlot';
      groupId: string | null;
      sectionId: string;
      weekday: number;
      period: number;
    }
  | { kind: 'group'; group?: Group | undefined }
  | { kind: 'generate' };

export function TimetableView() {
  const { institutionId: id } = useInstitution();
  const { can } = useMe();
  const manage = can('school.timetable.manage');
  const canCover = can('school.cover.manage');
  const [tab, setTab] = useState<'week' | 'cover'>(
    useSearchParams().get('tab') === 'cover' ? 'cover' : 'week',
  );
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['timetables', id],
    queryFn: () => api.get<Version[]>(`/school/timetable?institutionId=${id}`),
    enabled: !!id,
  });
  const [chosen, setChosen] = useState<string | null>(null);
  const versions = list.data ?? [];
  const selected =
    versions.find((v) => v.id === chosen) ??
    versions.find((v) => v.status === 'current') ??
    versions[0] ??
    null;
  const detail = useQuery({
    queryKey: ['timetable', selected?.id],
    queryFn: () => api.get<TimetableDetail>(`/school/timetable/${selected?.id}`),
    enabled: !!selected,
  });
  const [open, setOpen] = useState<Open | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const done = (m: string, nextId?: string) => {
    setOpen(null);
    setMessage(m);
    if (nextId) setChosen(nextId);
    void qc.invalidateQueries({ queryKey: ['timetables', id] });
    void qc.invalidateQueries({ queryKey: ['timetable'] });
  };

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const header = (
    <PageHeader
      icon={CalendarClock}
      art="timetable"
      area="violet"
      eyebrow={en.nav.groups.academics}
      title={t.title}
      description={t.lead}
      actions={
        manage && versions.length > 0 ? (
          <Button onClick={() => setOpen({ kind: 'new' })}>
            <Plus aria-hidden className="size-4" />
            {t.new}
          </Button>
        ) : null
      }
    />
  );

  let body;
  if (!id || list.isPending) body = <SkeletonRows rows={6} label={en.states.loading.title} />;
  else if (list.isError)
    body =
      list.error instanceof ApiFailure && list.error.status === 403 ? (
        <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
      ) : offline ? (
        <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
      ) : (
        <StatePanel kind="error" title={en.states.error.title} />
      );
  else if (!selected)
    body = (
      <EmptyState
        art="timetable"
        area="violet"
        title={t.empty}
        body={manage ? t.emptyBody : t.emptyReader}
        actions={
          manage ? (
            <Button onClick={() => setOpen({ kind: 'new' })}>
              <Plus aria-hidden className="size-4" />
              {t.new}
            </Button>
          ) : null
        }
      />
    );
  else
    body = (
      <>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-caption text-ink-muted">
            {t.versions}
            <select
              className="h-9 rounded-lg border border-line bg-surface px-2 text-body text-ink"
              value={selected.id}
              onChange={(e) => setChosen(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {statusText(v)}
                </option>
              ))}
            </select>
          </label>
          <Pill tone={TONE[selected.status]}>{statusText(selected)}</Pill>
          <span className="text-caption text-ink-muted">{t.slots(selected.slots)}</span>
          {manage && (
            <div className="ml-auto flex flex-wrap gap-2">
              {selected.state === 'draft' ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpen({ kind: 'generate' })}
                  >
                    <Sparkles aria-hidden className="size-3.5" />
                    {t.generate.button}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setOpen({ kind: 'schedule' })}
                  >
                    <Settings2 aria-hidden className="size-3.5" />
                    {t.schedule}
                  </Button>
                  <Button size="sm" onClick={() => setOpen({ kind: 'publish' })}>
                    <Send aria-hidden className="size-3.5" />
                    {t.publish}
                  </Button>
                </>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setOpen({ kind: 'copy' })}>
                  <Copy aria-hidden className="size-3.5" />
                  {t.copy}
                </Button>
              )}
            </div>
          )}
        </div>
        {detail.isPending ? (
          <SkeletonRows rows={8} label={en.states.loading.title} />
        ) : detail.isError ? (
          <StatePanel kind="error" title={en.states.error.title} />
        ) : (
          <>
            <Week
              detail={detail.data}
              editable={manage && selected.state === 'draft'}
              onCell={(sectionId, weekday, period) => {
                // A cell the section's group holds opens the group's lesson.
                const held = detail.data.slots.find(
                  (x) =>
                    x.groupId &&
                    x.weekday === weekday &&
                    x.period === period &&
                    detail.data.groups
                      .find((g) => g.id === x.groupId)
                      ?.sectionIds.includes(sectionId),
                );
                setOpen(
                  held
                    ? { kind: 'groupSlot', groupId: held.groupId, sectionId, weekday, period }
                    : { kind: 'slot', sectionId, weekday, period },
                );
              }}
            />
            <Groups
              detail={detail.data}
              editable={manage && selected.state === 'draft'}
              onEdit={(group) => setOpen({ kind: 'group', group })}
              onRemoved={() => done(t.groups.removed)}
            />
          </>
        )}
      </>
    );

  return (
    <div className="flex flex-col gap-6">
      {header}
      {canCover && id && (
        <div>
          <Segmented
            label={t.tabsLabel}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'week', label: t.tabs.week },
              { value: 'cover', label: t.tabs.cover },
            ]}
          />
        </div>
      )}
      {tab === 'cover' && canCover && id ? (
        <CoverTab
          institutionId={id}
          canMarkAway={can('staff.attendance.manage')}
          announce={setMessage}
        />
      ) : (
        body
      )}
      {open?.kind === 'new' && id && (
        <ScheduleForm
          institutionId={id}
          onClose={() => setOpen(null)}
          onDone={(newId) => done(t.saved, newId)}
        />
      )}
      {open?.kind === 'schedule' && detail.data && (
        <ScheduleForm
          detail={detail.data}
          onClose={() => setOpen(null)}
          onDone={() => done(t.saved)}
        />
      )}
      {open?.kind === 'copy' && selected && (
        <CopyForm
          version={selected}
          onClose={() => setOpen(null)}
          onDone={(newId) => done(t.saved, newId)}
        />
      )}
      {open?.kind === 'publish' && selected && (
        <PublishForm
          version={selected}
          onClose={() => setOpen(null)}
          onDone={() => done(t.published)}
        />
      )}
      {open?.kind === 'slot' && detail.data && (
        <SlotForm
          detail={detail.data}
          cell={open}
          onClose={() => setOpen(null)}
          onDone={() => done(t.saved)}
          onGroup={
            detail.data.groups.some((g) => g.sectionIds.includes(open.sectionId))
              ? () => setOpen({ ...open, kind: 'groupSlot', groupId: null })
              : undefined
          }
        />
      )}
      {open?.kind === 'groupSlot' && detail.data && (
        <GroupSlotForm
          detail={detail.data}
          cell={open}
          onClose={() => setOpen(null)}
          onDone={() => done(t.saved)}
        />
      )}
      {open?.kind === 'group' && detail.data && (
        <GroupForm
          detail={detail.data}
          group={open.group}
          onClose={() => setOpen(null)}
          onDone={() => done(t.saved)}
        />
      )}
      {open?.kind === 'generate' && detail.data && (
        <GenerateCanvas
          detail={detail.data}
          onClose={() => setOpen(null)}
          onDone={(n) => done(t.generate.done(n))}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

/** One section's or one teacher's week, with a day picker on phones. */
function Week({
  detail,
  editable,
  onCell,
}: {
  detail: TimetableDetail;
  editable: boolean;
  onCell: (sectionId: string, weekday: number, period: number) => void;
}) {
  const { plan, periods, slots, staff, version, groups } = detail;
  const groupOf = new Map(groups.map((g) => [g.id, g]));
  const [by, setBy] = useState<'section' | 'teacher'>('section');
  const [sectionId, setSectionId] = useState(plan.sections[0]?.sectionId ?? '');
  const teachers = useMemo(
    () => staff.filter((s) => slots.some((x) => x.teacherPersonId === s.personId)),
    [staff, slots],
  );
  const [teacherId, setTeacherId] = useState('');
  useEffect(() => {
    if (!plan.sections.some((s) => s.sectionId === sectionId))
      setSectionId(plan.sections[0]?.sectionId ?? '');
  }, [plan.sections, sectionId]);
  useEffect(() => {
    if (!teachers.some((s) => s.personId === teacherId)) setTeacherId(teachers[0]?.personId ?? '');
  }, [teachers, teacherId]);
  // On a phone one day shows at a time: today's, if the timetable has it (1 = Monday … 7 = Sunday).
  const [day, setDay] = useState(() => {
    const short = new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(new Date());
    const today = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(short) + 1;
    return String(version.days.includes(today) ? today : (version.days[0] ?? 1));
  });

  const subject = new Map(plan.offerings.map((o) => [o.subjectId, o]));
  const name = new Map(staff.map((s) => [s.personId, s.name]));
  const label = new Map(plan.sections.map((s) => [s.sectionId, s.label]));
  const shown =
    by === 'section'
      ? slots.filter(
          (x) =>
            x.sectionId === sectionId ||
            (x.groupId && groupOf.get(x.groupId)?.sectionIds.includes(sectionId)),
        )
      : slots.filter((x) => x.teacherPersonId === teacherId);
  /** A cell's lesson, or a group's lessons (one per subject). */
  const at = (weekday: number, period: number) =>
    shown.filter((x) => x.weekday === weekday && x.period === period);

  if (plan.sections.length === 0)
    return (
      <EmptyState
        compact
        title={t.noSections}
        body={t.noYear}
        actions={
          <Link href="/setup" className="font-medium text-navy-950 underline">
            {t.openSetup}
          </Link>
        }
      />
    );

  const cellText = (here: Slot[]) => {
    const s = here[0];
    if (!s) return null;
    const group = s.groupId ? groupOf.get(s.groupId) : undefined;
    if (group && by === 'section')
      return {
        main: group.name,
        sub: t.groups.cellSub(here.map((x) => subject.get(x.subjectId)?.code ?? '').join(', ')),
      };
    return {
      main: subject.get(s.subjectId)?.code ?? '',
      sub:
        by === 'section'
          ? [s.teacherPersonId ? name.get(s.teacherPersonId) : null, s.room]
              .filter(Boolean)
              .join(' · ')
          : [group ? t.groups.teacherSub(group.name) : label.get(s.sectionId ?? ''), s.room]
              .filter(Boolean)
              .join(' · '),
    };
  };

  const cell = (weekday: number, period: number) => {
    const text = cellText(at(weekday, period));
    const inner = text ? (
      <span className="flex w-full min-w-0 flex-col gap-0.5 text-left">
        <span className="font-medium text-ink">{text.main}</span>
        {text.sub && <span className="truncate text-caption text-ink-muted">{text.sub}</span>}
      </span>
    ) : editable && by === 'section' ? (
      <span className="text-caption text-ink-muted">
        <span aria-hidden>+</span>
        <span className="sr-only">{t.free}</span>
      </span>
    ) : (
      <span className="text-caption text-ink-muted">{t.free}</span>
    );
    const p = periods.find((x) => x.number === period);
    const n = p?.ordinal ?? period;
    return editable && by === 'section' ? (
      <button
        type="button"
        title={t.cellTitle(
          label.get(sectionId) ?? '',
          t.days[weekday] ?? '',
          n,
          `${p?.startsAt}–${p?.endsAt}`,
        )}
        onClick={() => onCell(sectionId, weekday, period)}
        className={cx(
          'flex min-h-14 w-full items-start rounded-lg border px-2 py-1.5 hover:border-navy-950 hover:bg-navy-50',
          text ? 'border-line bg-surface' : 'border-dashed border-line-strong',
        )}
      >
        <span className="sr-only">
          {t.cell(label.get(sectionId) ?? '', t.days[weekday] ?? '', n)}:{' '}
        </span>
        {inner}
      </button>
    ) : (
      <div
        className={cx(
          'flex min-h-14 items-start rounded-lg px-2 py-1.5',
          text ? 'border border-line bg-surface' : '',
        )}
      >
        {inner}
      </div>
    );
  };

  const sectionTargets = detail.targets[sectionId] ?? [];
  return (
    <Section flush>
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Segmented
          label={t.viewLabel}
          value={by}
          onChange={setBy}
          options={[
            { value: 'section', label: t.bySection },
            { value: 'teacher', label: t.byTeacher },
          ]}
        />
        {by === 'section' ? (
          <label className="flex items-center gap-2 text-caption text-ink-muted">
            {t.section}
            <select
              className="h-9 rounded-lg border border-line bg-surface px-2 text-body text-ink"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              {plan.sections.map((s) => (
                <option key={s.sectionId} value={s.sectionId}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : teachers.length > 0 ? (
          <label className="flex items-center gap-2 text-caption text-ink-muted">
            {t.teacher}
            <select
              className="h-9 rounded-lg border border-line bg-surface px-2 text-body text-ink"
              value={teacherId}
              onChange={(e) => setTeacherId(e.target.value)}
            >
              {teachers.map((s) => (
                <option key={s.personId} value={s.personId}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {by === 'teacher' && teacherId && (
          <span className="text-caption text-ink-muted tabular-nums">
            {t.teacherLoad(shown.length)}
          </span>
        )}
      </div>

      {by === 'section' && sectionTargets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <span className="text-caption text-ink-muted">{t.targets}</span>
          {sectionTargets.map((x) => {
            const code = subject.get(x.subjectId)?.code ?? '';
            const tone: Tone =
              x.target === null
                ? 'neutral'
                : x.placed === x.target
                  ? 'go'
                  : x.placed > x.target
                    ? 'stop'
                    : 'warn';
            return (
              <Pill key={x.subjectId} tone={tone}>
                {t.target(code, x.placed, x.target)}
              </Pill>
            );
          })}
        </div>
      )}

      {!editable && version.state === 'published' && (
        <p className="px-4 pt-3 text-caption text-ink-muted">{t.readOnly}</p>
      )}

      {by === 'teacher' && teachers.length === 0 ? (
        <p className="px-4 py-3 text-body text-ink-muted">{t.noTeacherPeriods}</p>
      ) : (
        <>
          {/* Phones: one day at a time. */}
          <div className="flex flex-col gap-3 p-4 sm:hidden">
            <Segmented
              label={t.day}
              value={day}
              onChange={setDay}
              options={version.days.map((d) => ({ value: String(d), label: t.daysShort[d] ?? '' }))}
            />
            <ol className="flex flex-col gap-2">
              {periods.map((p) =>
                p.kind === 'break' ? (
                  <li
                    key={p.number}
                    className="rounded-lg bg-paper px-3 py-1.5 text-caption text-ink-muted"
                  >
                    {p.label || t.breakRow} · {p.startsAt}–{p.endsAt}
                  </li>
                ) : (
                  <li
                    key={p.number}
                    className="grid grid-cols-[72px_minmax(0,1fr)] items-start gap-2"
                  >
                    <span className="pt-2 text-caption text-ink-muted tabular-nums">
                      {t.period(p.ordinal ?? p.number)}
                      <br />
                      {p.startsAt}
                    </span>
                    {cell(Number(day), p.number)}
                  </li>
                ),
              )}
            </ol>
          </div>
          {/* Larger screens: the whole week. */}
          <div
            role="region"
            aria-label={
              by === 'section'
                ? (label.get(sectionId) ?? t.title)
                : (name.get(teacherId) ?? t.title)
            }
            tabIndex={0}
            className="hidden overflow-x-auto p-4 sm:block"
          >
            <table className="w-full min-w-[720px] table-fixed border-separate border-spacing-1 text-body">
              <thead>
                <tr className="text-left text-caption text-ink-muted">
                  <th className="w-24 px-2 py-1 font-medium">
                    <span className="sr-only">{t.periods}</span>
                  </th>
                  {version.days.map((d) => (
                    <th key={d} scope="col" className="px-2 py-1 font-medium">
                      {t.days[d]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {periods.map((p) =>
                  p.kind === 'break' ? (
                    <tr key={p.number}>
                      <th
                        scope="row"
                        className="px-2 py-1 text-left text-caption font-normal text-ink-muted tabular-nums"
                      >
                        {p.startsAt}
                      </th>
                      <td
                        colSpan={version.days.length}
                        className="rounded-lg bg-paper px-3 py-1.5 text-caption text-ink-muted"
                      >
                        {p.label || t.breakRow} · {p.startsAt}–{p.endsAt}
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.number}>
                      <th scope="row" className="px-2 py-1 text-left align-top font-normal">
                        <span className="block text-caption font-medium text-ink">
                          {t.period(p.ordinal ?? p.number)}
                        </span>
                        <span className="block text-caption text-ink-muted tabular-nums">
                          {p.startsAt}–{p.endsAt}
                        </span>
                      </th>
                      {version.days.map((d) => (
                        <td key={d} className="align-top">
                          {cell(d, p.number)}
                        </td>
                      ))}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}

/** The version's teaching groups, with their sections; in a draft, add, edit and remove. */
function Groups({
  detail,
  editable,
  onEdit,
  onRemoved,
}: {
  detail: TimetableDetail;
  editable: boolean;
  onEdit: (group?: Group) => void;
  onRemoved: () => void;
}) {
  const g = t.groups;
  const label = new Map(detail.plan.sections.map((x) => [x.sectionId, x.label]));
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/school/timetable/${detail.version.id}/groups/${id}`),
    onSuccess: onRemoved,
  });
  if (!editable && detail.groups.length === 0) return null;
  return (
    <Section
      title={g.title}
      description={g.lead}
      flush
      {...(editable
        ? {
            actions: (
              <Button variant="secondary" size="sm" onClick={() => onEdit()}>
                <Plus aria-hidden className="size-3.5" />
                {g.new}
              </Button>
            ),
          }
        : {})}
    >
      {detail.groups.length === 0 ? (
        <p className="px-4 py-3 text-body text-ink-muted">{g.none}</p>
      ) : (
        <ul className="divide-y divide-line">
          {detail.groups.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="font-medium text-ink">{x.name}</span>
              <span className="text-caption text-ink-muted">
                {x.sectionIds.map((id) => label.get(id) ?? '').join(', ')}
              </span>
              {editable && (
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="quiet" onClick={() => onEdit(x)}>
                    {g.edit}
                    <span className="sr-only"> {x.name}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="quiet"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(x.id)}
                  >
                    {g.remove}
                    <span className="sr-only"> {x.name}</span>
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {remove.isError && (
        <p role="alert" className="px-4 pb-3 text-caption text-signal-stop-ink">
          {errorText(remove.error)}
        </p>
      )}
    </Section>
  );
}
