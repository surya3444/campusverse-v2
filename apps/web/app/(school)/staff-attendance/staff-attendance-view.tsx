'use client';

import type { AttendanceSettings, Day } from '@campusverse/shared-staff-attendance';
import {
  Announcer,
  Avatar,
  Button,
  EmptyState,
  PageHeader,
  Pill,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Clock, Download, MapPinOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { exportCsv } from '../../../lib/csv';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInline, fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { L, istToday } from '../staff/staff-list';
import { CELL, monthName, shiftMonth, thisMonth, type MonthRow } from './month-calendar';

const t = en.staffAttendance;
type Row = {
  personId: string;
  name: string;
  employeeCode: string;
  designation: string | null;
  photoFileId: string | null;
  day: Day | null;
  offCampus: boolean;
};
type Register = { staff: Row[]; settings: AttendanceSettings; names: Record<string, string> };

const time = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});
const shiftDay = (d: string, by: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const dayName = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

export function StaffAttendanceView() {
  const school = useInstitution();
  const { can } = useMe();
  const [view, setView] = useState<'register' | 'month' | 'settings'>('register');
  const id = school.institutionId;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Clock}
        art="attendance"
        area="teal"
        eyebrow={en.nav.groups.people}
        title={t.title}
        description={t.lead}
        actions={
          <Segmented
            label={t.title}
            value={view}
            onChange={setView}
            options={[
              { value: 'register', label: t.register },
              { value: 'month', label: t.month },
              ...(can('staff.attendance.manage')
                ? [{ value: 'settings' as const, label: t.settings }]
                : []),
            ]}
          />
        }
      />
      {!id ? (
        <SkeletonRows rows={5} label={en.states.loading.title} />
      ) : view === 'register' ? (
        <RegisterView institutionId={id} />
      ) : view === 'month' ? (
        <MonthView institutionId={id} />
      ) : (
        <SettingsView institutionId={id} />
      )}
    </div>
  );
}

function RegisterView({ institutionId }: { institutionId: string }) {
  const [date, setDate] = useState(istToday());
  const [message, setMessage] = useState<string | null>(null);
  const reg = useQuery({
    queryKey: ['staff-register', institutionId, date],
    queryFn: () =>
      api.get<Register>(`/staff-attendance/register?institutionId=${institutionId}&date=${date}`),
  });
  if (reg.isPending) return <SkeletonRows rows={6} label={en.states.loading.title} />;
  if (reg.isError || !reg.data)
    return reg.error instanceof ApiFailure && reg.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} />
    );
  const rows = reg.data.staff;
  const counts = {
    present: rows.filter((r) => r.day?.status === 'present' || r.day?.status === 'half_day').length,
    late: rows.filter((r) => r.day?.late).length,
    absent: rows.filter((r) => r.day?.status === 'absent').length,
    leave: rows.filter((r) => r.day?.status === 'on_leave' || r.day?.status === 'on_duty').length,
    notIn: rows.filter((r) => !r.day).length,
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t.previous}
            onClick={() => setDate(shiftDay(date, -1))}
            className="flex size-10 items-center justify-center rounded-lg border border-line-strong bg-surface hover:bg-paper"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </button>
          <input
            type="date"
            aria-label={t.date}
            value={date}
            max={istToday()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className={cx(fieldInline, 'w-44')}
          />
          <button
            type="button"
            aria-label={t.next}
            onClick={() => setDate(shiftDay(date, 1))}
            disabled={date >= istToday()}
            className="flex size-10 items-center justify-center rounded-lg border border-line-strong bg-surface hover:bg-paper disabled:opacity-30"
          >
            <ChevronRight aria-hidden className="size-4" />
          </button>
        </span>
        <span className="text-lead font-semibold text-ink">{dayName(date)}</span>
        {date !== istToday() && (
          <Button variant="quiet" onClick={() => setDate(istToday())}>
            {t.today}
          </Button>
        )}
      </div>
      <dl className="panel grid grid-cols-2 overflow-hidden sm:grid-cols-5">
        {(
          [
            ['present', 'bg-signal-go'],
            ['late', 'bg-signal-warn'],
            ['absent', 'bg-signal-stop'],
            ['leave', 'bg-violet-ink'],
            ['notIn', 'bg-ink-faint'],
          ] as const
        ).map(([k, dot], i) => (
          <div
            key={k}
            className={cx(
              'flex flex-col gap-1 border-line p-4',
              i > 0 && 'sm:border-l',
              i % 2 === 1 && 'max-sm:border-l',
              i > 1 && 'max-sm:border-t',
            )}
          >
            <dt className="flex items-center gap-2 text-caption font-medium text-ink-muted">
              <span aria-hidden className={cx('size-2 rounded-full', dot)} />
              {t.summary[k]}
            </dt>
            <dd className="tabular text-title font-bold text-ink">{counts[k]}</dd>
          </div>
        ))}
      </dl>
      <Section title={t.register} flush>
        {rows.length === 0 ? (
          <EmptyState compact art="students" title={t.empty} />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <RegisterRow
                key={r.personId}
                row={r}
                date={date}
                institutionId={institutionId}
                markedBy={r.day?.markedBy ? (reg.data.names[r.day.markedBy] ?? null) : null}
                onSaved={(m) => {
                  setMessage(m);
                  void reg.refetch();
                }}
              />
            ))}
          </ul>
        )}
      </Section>
      <Announcer message={message} />
    </>
  );
}

function RegisterRow({
  row: r,
  date,
  institutionId,
  markedBy,
  onSaved,
}: {
  row: Row;
  date: string;
  institutionId: string;
  markedBy: string | null;
  onSaved: (m: string) => void;
}) {
  const { can } = useMe();
  const [status, setStatus] = useState(r.day?.status ?? '');
  const [reason, setReason] = useState('');
  useEffect(() => setStatus(r.day?.status ?? ''), [r.day?.status]);
  const changing = status !== '' && status !== (r.day?.status ?? '');
  const needsReason = changing && !!r.day;
  const mark = useMutation({
    mutationFn: () =>
      api.post('/staff-attendance/mark', {
        institutionId,
        onDate: date,
        personId: r.personId,
        status,
        reason: reason || null,
      }),
    onSuccess: () => {
      setReason('');
      onSaved(t.saved);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mark.mutate();
  };
  const d = r.day;
  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-center">
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar
          name={r.name}
          src={r.photoFileId ? `/api/v1/people/${r.personId}/photo?v=${r.photoFileId}` : null}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium text-ink">{r.name}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-caption text-ink-muted">
            {r.designation && <span>{r.designation}</span>}
            {d?.firstIn && <span>{t.in(time.format(new Date(d.firstIn)))}</span>}
            {d?.lastOut && <span>{t.out(time.format(new Date(d.lastOut)))}</span>}
            {d?.source === 'register' && <span>{t.byOffice(markedBy ?? en.activity.someone)}</span>}
            {d?.reason && <span>· {d.reason}</span>}
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {d ? (
          <Pill
            tone={
              d.status === 'present'
                ? 'go'
                : d.status === 'absent'
                  ? 'stop'
                  : d.status === 'half_day'
                    ? 'warn'
                    : 'neutral'
            }
          >
            {t.statuses[d.status]}
          </Pill>
        ) : (
          <Pill>{t.notMarked}</Pill>
        )}
        {d?.late && <Pill tone="warn">{t.late}</Pill>}
        {d?.leftEarly && <Pill tone="warn">{t.leftEarly}</Pill>}
        {r.offCampus && (
          <span
            className="inline-flex items-center gap-1 text-caption text-signal-warn-ink"
            title={t.offCampus}
          >
            <MapPinOff aria-hidden className="size-3.5" />
            <span className="sr-only">{t.offCampus}</span>
          </span>
        )}
      </span>
      {can('staff.attendance.manage') && (
        <form
          onSubmit={submit}
          className="flex flex-wrap items-center gap-2"
          aria-label={`${t.mark}: ${r.name}`}
        >
          <select
            aria-label={`${t.mark}: ${r.name}`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className={cx(fieldInput, 'h-9 w-36')}
          >
            <option value="">{t.notMarked}</option>
            {Object.entries(t.statuses).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {needsReason && (
            <input
              aria-label={t.reason}
              placeholder={t.reason}
              required
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className={cx(fieldInput, 'h-9 w-52')}
            />
          )}
          {changing && (
            <Button type="submit" disabled={mark.isPending} className="h-9">
              {t.save}
            </Button>
          )}
          {mark.isError && (
            <span role="alert" className="basis-full text-caption text-signal-stop-ink">
              {errorText(mark.error)}
            </span>
          )}
        </form>
      )}
    </li>
  );
}

function MonthView({ institutionId }: { institutionId: string }) {
  const [month, setMonth] = useState(thisMonth());
  const report = useQuery({
    queryKey: ['staff-month', institutionId, month],
    queryFn: () =>
      api.get<{ staff: MonthRow[] }>(
        `/staff-attendance/report?institutionId=${institutionId}&month=${month}`,
      ),
  });
  const cols = [
    'worked',
    'present',
    'half_day',
    'absent',
    'on_leave',
    'on_duty',
    'late',
    'leftEarly',
  ] as const;
  const download = () => {
    if (!report.data) return;
    void exportCsv(
      'staff_attendance',
      institutionId,
      `staff-attendance-${month}`,
      ['Employee code', t.columns.name ?? 'Name', ...cols.map((c) => t.columns[c] ?? c)],
      report.data.staff.map((s) => [s.employeeCode, s.name, ...cols.map((c) => s.totals[c] ?? 0)]),
    );
  };
  const [y = 1970, m = 1] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();

  return (
    <Section
      title={t.monthTitle(monthName(month))}
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
          <Button variant="secondary" onClick={download} disabled={!report.data}>
            <Download aria-hidden className="size-4" />
            {t.download}
          </Button>
        </span>
      }
    >
      {report.isPending ? (
        <div className="p-5">
          <SkeletonRows rows={5} label={en.states.loading.title} />
        </div>
      ) : report.isError || !report.data ? (
        <StatePanel kind="error" title={errorText(report.error)} />
      ) : (
        <div
          role="region"
          aria-label={t.monthTitle(monthName(month))}
          tabIndex={0}
          className="overflow-x-auto"
        >
          <table className="w-full min-w-[900px] text-body">
            <thead>
              <tr className="border-b border-line text-left text-caption text-ink-muted">
                <th className="sticky left-0 bg-surface px-5 py-2.5 font-medium">
                  {t.columns.name}
                </th>
                <th className="px-2 py-2.5 font-medium" colSpan={days}>
                  {monthName(month)}
                </th>
                {cols.map((c) => (
                  <th key={c} className="px-3 py-2.5 text-right font-medium">
                    {t.columns[c]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.data.staff.map((s) => {
                const by = new Map(s.days.map((d) => [d.onDate, d]));
                return (
                  <tr key={s.personId} className="border-b border-line last:border-0">
                    <th
                      scope="row"
                      className="sticky left-0 bg-surface px-5 py-2.5 text-left font-medium text-ink"
                    >
                      {s.name}
                    </th>
                    {Array.from({ length: days }, (_, i) => {
                      const d = by.get(`${month}-${String(i + 1).padStart(2, '0')}`);
                      return (
                        <td key={i} className="px-0.5 py-2.5">
                          <span
                            title={d ? t.statuses[d.status] : t.notMarked}
                            className={cx(
                              'block size-3.5 rounded-sm',
                              d ? CELL[d.status] : 'bg-paper',
                            )}
                          />
                        </td>
                      );
                    })}
                    {cols.map((c) => (
                      <td key={c} className="tabular px-3 py-2.5 text-right text-ink">
                        {s.totals[c] ?? 0}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function SettingsView({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['staff-attendance-settings', institutionId],
    queryFn: () =>
      api.get<AttendanceSettings>(`/staff-attendance/settings?institutionId=${institutionId}`),
  });
  const [form, setForm] = useState<AttendanceSettings | null>(null);
  useEffect(() => {
    if (settings.data) setForm(settings.data);
  }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api.post(`/staff-attendance/settings?institutionId=${institutionId}`, form),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ['staff-attendance-settings', institutionId] }),
  });
  if (!form) return <SkeletonRows rows={4} label={en.states.loading.title} />;
  const num = (k: keyof AttendanceSettings) => (e: { target: { value: string } }) =>
    setForm((f) => (f ? { ...f, [k]: Number(e.target.value) } : f));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} aria-label={t.settingsTitle}>
      <Section
        title={t.settingsTitle}
        footer={
          <>
            <span role="status" className="flex-1">
              {save.isError ? (
                <span className="text-signal-stop-ink">{errorText(save.error)}</span>
              ) : save.isSuccess ? (
                t.saved
              ) : (
                ''
              )}
            </span>
            <Button type="submit" disabled={save.isPending}>
              {t.save}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <L label={t.startsAt}>
            <input
              type="time"
              required
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              className={fieldInput}
            />
          </L>
          <L label={t.endsAt}>
            <input
              type="time"
              required
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              className={fieldInput}
            />
          </L>
          <L label={t.lateAfter}>
            <input
              type="number"
              min={0}
              max={180}
              value={form.lateAfterMinutes}
              onChange={num('lateAfterMinutes')}
              className={fieldInput}
            />
          </L>
          <L label={t.earlyBefore}>
            <input
              type="number"
              min={0}
              max={180}
              value={form.earlyBeforeMinutes}
              onChange={num('earlyBeforeMinutes')}
              className={fieldInput}
            />
          </L>
          <L label={t.fullDay}>
            <input
              type="number"
              min={60}
              max={720}
              step={15}
              value={form.fullDayMinutes}
              onChange={num('fullDayMinutes')}
              className={fieldInput}
            />
          </L>
          <label className="flex items-start gap-3 self-end pb-2 sm:col-span-2 lg:col-span-1">
            <input
              type="checkbox"
              checked={form.requireOnCampus}
              onChange={(e) => setForm({ ...form, requireOnCampus: e.target.checked })}
              className="mt-1 size-4 accent-navy-950"
            />
            <span className="flex flex-col">
              <span className="text-body font-medium text-ink">{t.requireOnCampus}</span>
              <span className="text-caption text-ink-muted">{t.requireOnCampusHint}</span>
            </span>
          </label>
        </div>
      </Section>
    </form>
  );
}
