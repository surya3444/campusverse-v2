'use client';

// Cover for the day: each away teacher's lessons, with the best free teachers as one-tap buttons
// (why each is suggested is said in words), combine or supervise when nobody fits, and undo.
import type { CoverDay, CoverKind, CoverLesson } from '@campusverse/school-timetable';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserMinus } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { errorText, t } from './shared';

const c = t.cover;
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

export function CoverTab({
  institutionId,
  canMarkAway,
  announce,
}: {
  institutionId: string;
  canMarkAway: boolean;
  announce: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [date, setDate] = useState(todayIso);
  const key = ['timetable-cover', institutionId, date];
  const day = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<CoverDay>(`/school/timetable/cover?institutionId=${institutionId}&date=${date}`),
    enabled: !!date,
  });
  const [marking, setMarking] = useState(false);
  const refresh = (m: string) => {
    announce(m);
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ['today'] });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-caption text-ink-muted">
          {c.date}
          <input
            type="date"
            className={`${fieldInput} w-auto`}
            value={date}
            min={todayIso()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {day.data && !day.data.holiday && day.data.timetableId && (
          <Pill tone={day.data.open > 0 ? 'stop' : 'go'}>{c.open(day.data.open)}</Pill>
        )}
        {canMarkAway && day.data?.timetableId && !day.data.holiday && (
          <Button
            variant="secondary"
            size="sm"
            className="ml-auto"
            onClick={() => setMarking(true)}
          >
            <UserMinus aria-hidden className="size-3.5" />
            {c.markAway}
          </Button>
        )}
      </div>

      {day.isPending ? (
        <SkeletonRows rows={4} label={en.states.loading.title} />
      ) : day.isError ? (
        <StatePanel kind="error" title={en.states.error.title} />
      ) : day.data.holiday ? (
        <EmptyState compact title={c.holiday(day.data.holiday)} />
      ) : !day.data.timetableId ? (
        <EmptyState compact title={c.noTimetable} />
      ) : day.data.away.length === 0 ? (
        <EmptyState compact title={c.allIn} body={c.allInBody} />
      ) : (
        day.data.away.map((a) => (
          <Section
            key={a.personId}
            title={a.name}
            description={[c.statuses[a.status], a.reason].filter(Boolean).join(' · ')}
            flush
          >
            <ul className="divide-y divide-line">
              {a.lessons.map((l) => (
                <LessonRow
                  key={l.slotId}
                  lesson={l}
                  institutionId={institutionId}
                  date={date}
                  onDone={refresh}
                />
              ))}
            </ul>
          </Section>
        ))
      )}

      {marking && day.data && (
        <MarkAway
          institutionId={institutionId}
          date={date}
          day={day.data}
          onClose={() => setMarking(false)}
          onDone={() => {
            setMarking(false);
            refresh(c.marked);
          }}
        />
      )}
    </div>
  );
}

function LessonRow({
  lesson: l,
  institutionId,
  date,
  onDone,
}: {
  lesson: CoverLesson;
  institutionId: string;
  date: string;
  onDone: (m: string) => void;
}) {
  const [changing, setChanging] = useState(false);
  const label = c.lesson(l.ordinal, l.startsAt, l.section, l.subject);
  const assign = useMutation({
    mutationFn: (v: { kind: CoverKind; personId?: string; name?: string }) =>
      api.post('/school/timetable/cover', {
        institutionId,
        date,
        slotId: l.slotId,
        kind: v.kind,
        ...(v.personId ? { coveringPersonId: v.personId } : {}),
      }),
    onSuccess: (_r, v) => {
      setChanging(false);
      onDone(v.name ? c.assigned(v.name) : en.timetablePage.saved);
    },
  });
  const undo = useMutation({
    mutationFn: () => api.post(`/school/timetable/cover/${l.cover?.id}/cancel`, { institutionId }),
    onSuccess: () => onDone(c.cancelled),
  });
  const state = !l.cover
    ? { tone: 'stop' as const, text: c.notCovered }
    : l.cover.kind === 'teacher'
      ? { tone: 'go' as const, text: c.coveredBy(l.cover.name ?? '') }
      : { tone: 'warn' as const, text: l.cover.kind === 'combined' ? c.combined : c.supervised };
  const choosing = !l.cover || changing;
  const why = (s: CoverLesson['suggestions'][number]) =>
    [
      s.teachesSubject ? c.why.subject : null,
      s.teachesSection ? c.why.section : null,
      c.why.covers(s.coversThisWeek),
      c.why.lessons(s.lessonsToday),
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink tabular-nums">{label}</span>
        <Pill tone={state.tone}>{state.text}</Pill>
        {l.cover && !changing && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" variant="quiet" onClick={() => setChanging(true)}>
              {c.change}
            </Button>
            <Button
              size="sm"
              variant="quiet"
              disabled={undo.isPending}
              onClick={() => undo.mutate()}
            >
              {c.undo}
            </Button>
          </span>
        )}
      </div>
      {choosing && (
        <div className="flex flex-col gap-2">
          {l.suggestions.length === 0 ? (
            <p className="text-caption text-ink-muted">{c.nobodyFree}</p>
          ) : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {l.suggestions
                .filter((s) => s.personId !== l.cover?.personId)
                .slice(0, 3)
                .map((s) => (
                  <li key={s.personId}>
                    <button
                      type="button"
                      disabled={assign.isPending}
                      onClick={() =>
                        assign.mutate({ kind: 'teacher', personId: s.personId, name: s.name })
                      }
                      className="flex min-h-14 w-full flex-col items-start rounded-lg border border-line px-3 py-2 text-left hover:border-navy-950 hover:bg-navy-50 disabled:opacity-50"
                    >
                      <span className="font-medium text-ink">
                        {s.name}
                        <span className="sr-only"> {c.assignRest(label)}</span>
                      </span>
                      <span className="text-caption text-ink-muted">{why(s)}</span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={assign.isPending}
              onClick={() => assign.mutate({ kind: 'combined' })}
            >
              {c.combine}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={assign.isPending}
              onClick={() => assign.mutate({ kind: 'supervised' })}
            >
              {c.supervise}
            </Button>
            {changing && (
              <Button size="sm" variant="quiet" onClick={() => setChanging(false)}>
                {t.cancel}
              </Button>
            )}
          </div>
          {assign.error && (
            <p role="alert" className="text-caption text-signal-stop-ink">
              {errorText(assign.error)}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Marks a teacher away for the day (the staff register), so their lessons need cover. */
function MarkAway({
  institutionId,
  date,
  day,
  onClose,
  onDone,
}: {
  institutionId: string;
  date: string;
  day: CoverDay;
  onClose: () => void;
  onDone: () => void;
}) {
  const later = date > todayIso();
  const [personId, setPersonId] = useState('');
  const [status, setStatus] = useState(later ? 'on_leave' : 'absent');
  const [reason, setReason] = useState('');
  const mark = useMutation({
    mutationFn: () =>
      api.post('/staff-attendance/mark', {
        institutionId,
        onDate: date,
        personId,
        status,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={c.markAway}
      submitLabel={c.markAway}
      cancelLabel={t.cancel}
      pending={mark.isPending}
      submitDisabled={!personId}
      error={mark.error ? errorText(mark.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => mark.mutate()}
    >
      <ModalField label={c.who} wide>
        <select
          className={fieldInput}
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
        >
          <option value="">{c.chooseWho}</option>
          {day.teaching.map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name} · {c.why.lessons(p.lessons)}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={c.status} {...(later ? { hint: c.futureHint } : {})} wide>
        <select className={fieldInput} value={status} onChange={(e) => setStatus(e.target.value)}>
          {(later ? ['on_leave', 'on_duty'] : ['absent', 'on_leave', 'on_duty']).map((s) => (
            <option key={s} value={s}>
              {c.statuses[s]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={c.reason} wide>
        <input className={fieldInput} value={reason} onChange={(e) => setReason(e.target.value)} />
      </ModalField>
    </FormModal>
  );
}
