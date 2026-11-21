'use client';

// Timetable › My Timetable (rule book §13: "Teacher's week; Google or Outlook calendar sync"):
// the signed-in teacher's week across their schools: their lessons, covers they take, lessons
// covered for them, papers they invigilate; and a private link that keeps their calendar in step.
import type { MyDay, MyLesson, MyWeek } from '@campusverse/school-timetable';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  PageHeader,
  Pill,
  Section,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Copy,
  ClipboardCheck,
} from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { LessonCard, subjectColors } from '../timetable/lesson-card';

const t = en.myTimetable;
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-IN', { ...o, timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const nowHHMM = () =>
  new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(new Date());

const lessonSub = (l: MyLesson) =>
  [
    l.section,
    l.room,
    l.kind === 'covering'
      ? t.coverFor(l.other)
      : l.kind === 'covered'
        ? t.coveredBy(l.other)
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

export function MyTimetableView() {
  const [date, setDate] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const week = useQuery({
    queryKey: ['my-timetable', date],
    queryFn: () => api.get<MyWeek>(`/school/timetable/mine${date ? `?date=${date}` : ''}`),
  });

  if (week.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (week.isError)
    return week.error instanceof ApiFailure && week.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={t.errors.error}
        action={en.states.error.action}
        onAction={() => void week.refetch()}
      />
    );
  const w = week.data;
  const lessons = w.days.flatMap((d) => d.lessons);
  const thisWeek = w.days.some((d) => d.date === w.today);
  const today = w.days.find((d) => d.date === w.today);
  const shown = w.days.filter((d, i) => i < 6 || d.lessons.length > 0 || d.exams.length > 0);
  const empty = lessons.length === 0 && w.days.every((d) => d.exams.length === 0);
  const colorOf = subjectColors(lessons.map((l) => l.subject));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={CalendarClock}
        area="violet"
        eyebrow={en.nav.timetable}
        title={t.title}
        description={t.lead}
        actions={
          <Button variant="secondary" onClick={() => setLinking(true)} aria-haspopup="dialog">
            <CalendarPlus aria-hidden className="size-4" />
            {w.feed.live ? t.calendar.manage : t.calendar.add}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDate(addDays(w.from, -7))}
            aria-label={t.previous}
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Button>
          <span
            className="tabular min-w-44 text-center text-body font-medium text-ink"
            aria-live="polite"
          >
            {t.range(
              fmt(w.from, { day: 'numeric', month: 'short' }),
              fmt(addDays(w.from, 6), { day: 'numeric', month: 'short', year: 'numeric' }),
            )}
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDate(addDays(w.from, 7))}
            aria-label={t.next}
          >
            <ChevronRight aria-hidden className="size-4" />
          </Button>
          {!thisWeek && (
            <Button variant="quiet" size="sm" onClick={() => setDate(null)}>
              {t.thisWeek}
            </Button>
          )}
        </div>
      </PageHeader>

      <KeyFigures
        variant="strip"
        label={t.figures}
        figures={[
          {
            label: t.fig.lessons,
            value: String(lessons.filter((l) => l.kind === 'own').length),
            note: t.fig.lessonsNote,
            valueTone: 'navy',
          },
          {
            label: t.fig.covering,
            value: String(lessons.filter((l) => l.kind === 'covering').length),
            note: t.fig.coveringNote,
          },
          {
            label: t.fig.covered,
            value: String(lessons.filter((l) => l.kind === 'covered').length),
            note: t.fig.coveredNote,
          },
          {
            label: t.fig.invigilation,
            value: String(w.days.reduce((a, d) => a + d.exams.length, 0)),
            note: t.fig.invigilationNote,
          },
        ]}
      />

      {empty ? (
        <div className="panel">
          <EmptyState icon={CalendarClock} area="violet" title={t.emptyTitle} body={t.emptyBody} />
        </div>
      ) : (
        <>
          {thisWeek && today && <Today day={today} colorOf={colorOf} />}
          <Week days={shown} today={w.today} colorOf={colorOf} />
        </>
      )}

      {linking && (
        <CalendarDialog
          live={w.feed.live}
          onClose={() => setLinking(false)}
          onDone={(m) => {
            setMessage(m);
            void week.refetch();
          }}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

type ColorOf = ReturnType<typeof subjectColors>;

/** Today's lessons in order, with what's on now and what's next. */
function Today({ day, colorOf }: { day: MyDay; colorOf: ColorOf }) {
  const now = nowHHMM();
  const items = day.lessons.filter((l) => l.kind !== 'covered');
  const current = items.find((l) => l.startsAt <= now && now < l.endsAt);
  const next = items.find((l) => l.startsAt > now);
  return (
    <Section
      title={t.today}
      description={
        day.holiday
          ? t.holiday(day.holiday)
          : items.length === 0 && day.exams.length === 0 && day.lessons.length > 0
            ? t.awayToday
            : items.length === 0 && day.exams.length === 0
              ? t.freeToday
              : current
                ? t.now(current.subject, current.endsAt)
                : next
                  ? t.nextAt(next.subject, next.startsAt)
                  : t.doneToday
      }
    >
      {!day.holiday && (day.lessons.length > 0 || day.exams.length > 0) && (
        <ol className="flex flex-col gap-2">
          {day.exams.map((e) => (
            <li key={`${e.exam}-${e.subject}`} className="flex items-center gap-3">
              <span className="tabular w-24 shrink-0 text-caption text-ink-muted">
                {e.startsAt && e.endsAt ? `${e.startsAt}–${e.endsAt}` : t.allDay}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-2">
                <Pill tone="warn">{t.invigilation}</Pill>
                <span className="text-body font-medium text-ink">
                  {e.exam} · {e.subject} · {e.className}
                </span>
                {e.room && <span className="text-caption text-ink-muted">{e.room}</span>}
              </span>
            </li>
          ))}
          {day.lessons.map((l) => {
            const on = l === current;
            return (
              <li key={`${l.startsAt}-${l.section}`} className="flex items-center gap-3">
                <span
                  className={cx(
                    'tabular w-24 shrink-0 text-caption',
                    on ? 'font-semibold text-navy-950' : 'text-ink-muted',
                  )}
                >
                  {l.startsAt}–{l.endsAt}
                </span>
                <span className="min-w-0 flex-1">
                  <LessonCard
                    subject={l.subject}
                    sub={lessonSub(l)}
                    color={colorOf(l.subject)}
                    muted={l.kind === 'covered'}
                    dashed={l.kind === 'covering'}
                    tag={
                      on ? (
                        <Pill tone="go">{t.nowTag}</Pill>
                      ) : l.kind === 'covering' ? (
                        <Pill tone="warn">{t.coverTag}</Pill>
                      ) : null
                    }
                  />
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}

/** The week as the hub's grid: a column per day, a row per time, a card per lesson. */
function Week({ days, today, colorOf }: { days: MyDay[]; today: string; colorOf: ColorOf }) {
  const times = [
    ...new Set(days.flatMap((d) => d.lessons.map((l) => `${l.startsAt}–${l.endsAt}`))),
  ].sort();
  const at = (d: MyDay, time: string) =>
    d.lessons.filter((l) => `${l.startsAt}–${l.endsAt}` === time);
  return (
    <Section title={t.week} flush>
      {/* Desktop: the grid. */}
      <div
        role="region"
        aria-label={t.week}
        tabIndex={0}
        className="hidden overflow-x-auto border-t border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-950 md:block"
      >
        <table className="w-full min-w-[720px] table-fixed text-body">
          <thead>
            <tr>
              <th
                scope="col"
                className="w-28 px-3 py-2 text-left text-caption font-medium text-ink-muted"
              >
                {t.time}
              </th>
              {days.map((d) => (
                <th
                  key={d.date}
                  scope="col"
                  className={cx(
                    'px-1.5 py-2 text-left text-caption font-medium',
                    d.date === today ? 'text-navy-950' : 'text-ink-muted',
                  )}
                >
                  <span className="block uppercase">{fmt(d.date, { weekday: 'short' })}</span>
                  <span
                    className={cx(
                      'tabular inline-flex items-center gap-1.5',
                      d.date === today && 'font-semibold',
                    )}
                  >
                    {fmt(d.date, { day: 'numeric', month: 'short' })}
                    {d.date === today && <Pill tone="go">{t.todayTag}</Pill>}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.some((d) => d.exams.length > 0) && (
              <tr className="border-t border-line/60">
                <th
                  scope="row"
                  className="px-3 py-2 text-left align-top text-caption font-medium text-ink-muted"
                >
                  {t.invigilation}
                </th>
                {days.map((d) => (
                  <td key={d.date} className="p-1 align-top">
                    {d.exams.map((e) => (
                      <span
                        key={`${e.exam}-${e.subject}`}
                        className="mb-1 block rounded-lg border border-dashed border-line-strong px-2 py-1.5 text-caption"
                      >
                        <span className="block font-semibold text-ink">{e.subject}</span>
                        <span className="tabular block text-ink-muted">
                          {[
                            e.startsAt && e.endsAt ? `${e.startsAt}–${e.endsAt}` : null,
                            e.className,
                            e.room,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    ))}
                  </td>
                ))}
              </tr>
            )}
            {times.map((time) => (
              <tr key={time} className="border-t border-line/60">
                <th
                  scope="row"
                  className="tabular px-3 py-2 text-left align-top text-caption font-medium text-ink"
                >
                  {time}
                </th>
                {days.map((d) =>
                  d.holiday ? (
                    <td
                      key={d.date}
                      className="bg-paper p-1 text-center align-middle text-caption text-ink-muted"
                    >
                      {time === times[0] ? d.holiday : ''}
                    </td>
                  ) : (
                    <td
                      key={d.date}
                      className={cx('p-1 align-top', d.date === today && 'bg-navy-50/40')}
                    >
                      <span className="flex flex-col gap-1">
                        {at(d, time).map((l) => (
                          <LessonCard
                            key={`${l.section}-${l.kind}`}
                            subject={l.subject}
                            sub={lessonSub(l)}
                            color={colorOf(l.subject)}
                            muted={l.kind === 'covered'}
                            dashed={l.kind === 'covering'}
                          />
                        ))}
                      </span>
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phone: day by day. */}
      <ol className="flex flex-col divide-y divide-line border-t border-line md:hidden">
        {days.map((d) => (
          <li key={d.date} className="flex flex-col gap-2 px-4 py-3">
            <h3 className="flex items-center gap-2 text-body font-semibold text-ink">
              {fmt(d.date, { weekday: 'long', day: 'numeric', month: 'short' })}
              {d.date === today && <Pill tone="go">{t.todayTag}</Pill>}
            </h3>
            {d.holiday ? (
              <p className="text-caption text-ink-muted">{t.holiday(d.holiday)}</p>
            ) : d.lessons.length === 0 && d.exams.length === 0 ? (
              <p className="text-caption text-ink-muted">{t.noLessons}</p>
            ) : (
              <>
                {d.exams.map((e) => (
                  <p key={`${e.exam}-${e.subject}`} className="text-caption text-ink">
                    <Pill tone="warn">{t.invigilation}</Pill> {e.subject} · {e.className}
                    {e.startsAt ? ` · ${e.startsAt}` : ''}
                  </p>
                ))}
                {d.lessons.map((l) => (
                  <div
                    key={`${l.startsAt}-${l.section}-${l.kind}`}
                    className="flex items-center gap-3"
                  >
                    <span className="tabular w-12 shrink-0 text-caption text-ink-muted">
                      {l.startsAt}
                    </span>
                    <LessonCard
                      subject={l.subject}
                      sub={lessonSub(l)}
                      color={colorOf(l.subject)}
                      muted={l.kind === 'covered'}
                      dashed={l.kind === 'covering'}
                    />
                  </div>
                ))}
              </>
            )}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** The private calendar link: shown once when made; a new one ends the old one. */
function CalendarDialog({
  live,
  onClose,
  onDone,
}: {
  live: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const qc = useQueryClient();
  const c = t.calendar;
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const make = useMutation({
    mutationFn: () => api.post<{ path: string }>('/school/timetable/mine/calendar', {}),
    onSuccess: (r) => {
      setUrl(`${window.location.origin}/api/v1/${r.path}`);
      void qc.invalidateQueries({ queryKey: ['my-timetable'] });
      onDone(c.made);
    },
  });
  const stop = useMutation({
    mutationFn: () => api.post('/school/timetable/mine/calendar/stop', {}),
    onSuccess: () => {
      onDone(c.stopped);
      onClose();
    },
  });
  const copy = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };
  return (
    <FormModal
      title={c.title}
      description={c.lead}
      submitLabel={url ? c.done : live ? c.remake : c.make}
      cancelLabel={en.form.cancel}
      size="lg"
      pending={make.isPending}
      error={make.isError || stop.isError ? t.errors.error : null}
      onClose={onClose}
      onSubmit={() => (url ? onClose() : make.mutate())}
    >
      {url ? (
        <div className="col-span-full flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{c.yourLink}</span>
            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                aria-label={c.yourLink}
                onFocus={(e) => e.target.select()}
                className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-paper px-3 font-mono text-caption text-ink"
              />
              <Button variant="secondary" onClick={() => void copy()}>
                {copied ? (
                  <ClipboardCheck aria-hidden className="size-4" />
                ) : (
                  <Copy aria-hidden className="size-4" />
                )}
                {copied ? c.copied : c.copy}
              </Button>
            </div>
            <p className="text-caption text-signal-warn-ink">{c.once}</p>
          </div>
          <ol className="grid gap-3 sm:grid-cols-2">
            {c.steps.map(([app, how]) => (
              <li key={app} className="rounded-xl bg-paper p-3">
                <span className="block text-body font-semibold text-ink">{app}</span>
                <span className="text-caption text-ink-muted">{how}</span>
              </li>
            ))}
          </ol>
          <p className="text-caption text-ink-muted">{c.updates}</p>
        </div>
      ) : (
        <div className="col-span-full flex flex-col gap-3">
          <p className="text-body text-ink">{live ? c.liveBody : c.newBody}</p>
          <p className="text-caption text-ink-muted">{c.private}</p>
          {live && (
            <div>
              <Button variant="quiet" disabled={stop.isPending} onClick={() => stop.mutate()}>
                {c.stop}
              </Button>
            </div>
          )}
        </div>
      )}
    </FormModal>
  );
}
