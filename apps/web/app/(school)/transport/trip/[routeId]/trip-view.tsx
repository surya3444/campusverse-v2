'use client';

// The bus attendant's sheet: one route today, stop by stop, a large tile per child. Every tap is
// stored on the phone first and sent through the offline sync queue, so a dead zone on the route
// loses nothing. The trip ends only with the empty-bus check.
import type { MarkKind, RiderState, SheetRider, TripSheet } from '@campusverse/shared-transport';
import {
  Announcer,
  Button,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  Section,
  SkeletonRows,
  StatePanel,
  cx,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bus, Play, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../../lib/api';
import { deviceId, enqueue, flush, uuidv7 } from '../../../../../lib/sync-queue';
import { en } from '../../../../../messages/en';
import { useInstitution } from '../../../attendance/shared';
import { PendingBanner } from '../../../attendance/pending-banner';
import { fieldInput } from '../../../common/custom-fields';
import { useMe } from '../../../common/me';
import { errorText, t } from '../../shared';
import { SosButton } from '../../sos';
import { StartWithReason, tripsKey, useStartTrip } from '../../today-tab';

const s = t.trip;
const d = t.today;

// Where a tap puts the child (as the server's domain/trip.ts), for an instant answer on screen.
const AFTER: Record<MarkKind, RiderState> = {
  boarded: 'on_board',
  nobody_at_stop: 'on_board',
  not_boarded: 'not_boarded',
  dropped: 'dropped',
  handed_to_school: 'at_school',
};
const TONE: Record<RiderState, Tone> = {
  expected: 'neutral',
  on_board: 'warn',
  not_boarded: 'neutral',
  dropped: 'go',
  at_school: 'go',
};

export function TripView({ routeId }: { routeId: string }) {
  const { institutionId: id } = useInstitution();
  const me = useMe();
  const qc = useQueryClient();
  const key = ['transport-trip', id, routeId];
  const sheet = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<TripSheet>(`/transport/trips/sheet?institutionId=${id}&routeId=${routeId}`),
    enabled: !!id,
    refetchInterval: 20_000,
  });
  // Taps not yet confirmed by the server, so the tile answers at once (and offline).
  const [local, setLocal] = useState<Record<string, RiderState>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const [reasonFor, setReasonFor] = useState(false);
  const start = useStartTrip(id ?? '');

  const offline = typeof navigator !== 'undefined' && !navigator.onLine;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    if (id) void qc.invalidateQueries({ queryKey: tripsKey(id) });
  };

  if (!id || sheet.isPending) return <SkeletonRows rows={6} label={en.states.loading.title} />;
  if (sheet.isError)
    return sheet.error instanceof ApiFailure && sheet.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : offline ? (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} />
    );

  const trip = sheet.data;
  const attend = me.can('transport.trip.attend');
  const running = !!trip.trip && !trip.trip.endedAt;
  const canTap = attend && running && !!me.data;
  const stateOf = (r: SheetRider) => local[r.personId] ?? r.state;
  const everyone = trip.stops.flatMap((x) => x.riders);
  const onBoard = everyone.filter((r) => stateOf(r) === 'on_board');

  const tap = async (riders: SheetRider[], kind: MarkKind, done: string) => {
    if (!trip.trip || !me.data) return;
    setProblem(null);
    const ids = riders.map(() => uuidv7());
    setLocal((m) => ({
      ...m,
      ...Object.fromEntries(riders.map((r) => [r.personId, AFTER[kind]])),
    }));
    for (const [i, r] of riders.entries())
      await enqueue({
        eventId: ids[i] ?? uuidv7(),
        deviceId: deviceId(),
        actorId: me.data.personId,
        occurredAt: new Date().toISOString(),
        type: 'transport.mark',
        payload: { institutionId: id, tripId: trip.trip.id, personId: r.personId, kind },
        label: `${trip.name}: ${r.name}`,
      });
    setMessage(done);
    const answers = (await flush()).filter((a) => ids.includes(a.eventId));
    if (answers.length === 0) {
      setMessage(s.queued);
      return;
    }
    const refused = answers.find((a) => a.outcome === 'rejected');
    if (refused) setProblem(t.errors[refused.code ?? 'error'] ?? t.errors.error ?? '');
    setLocal({});
    refresh();
  };

  const tiles = (riders: SheetRider[], marks: MarkKind[], when?: (r: SheetRider) => boolean) =>
    riders.length === 0 ? (
      <p className="px-4 py-3 text-body text-ink-muted">{s.noRiders}</p>
    ) : (
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2 p-3 sm:grid-cols-2">
        {riders.map((r) => {
          const st = stateOf(r);
          return (
            <li key={r.personId} className="flex flex-col gap-2 rounded-lg border border-line p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium text-ink">{r.name}</p>
                  {r.label && <p className="text-caption text-ink-muted">{r.label}</p>}
                  {r.skipping && (
                    <p className="text-caption font-medium text-signal-warn-ink">{s.skipping}</p>
                  )}
                </div>
                <Pill tone={TONE[st]}>{s.states[st]}</Pill>
              </div>
              {canTap && (!when || when(r)) && (
                <div className="flex gap-2">
                  {marks.map((k) => (
                    <Button
                      key={k}
                      variant={AFTER[k] === st ? 'primary' : 'secondary'}
                      className="min-h-11 flex-1"
                      aria-label={s.markFor(s.marks[k] ?? k, r.name)}
                      aria-pressed={AFTER[k] === st}
                      onClick={() => void tap([r], k, s.marked(s.marks[k] ?? k, r.name))}
                    >
                      {s.marks[k]}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );

  const pickup = trip.direction === 'pickup';
  const info = [
    pickup ? d.pickup : d.drop,
    trip.firstAt && trip.lastAt ? d.times(trip.firstAt, trip.lastAt) : null,
    trip.vehicle,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Bus}
        art="transport"
        area="amber"
        eyebrow={
          <Link href="/transport" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft aria-hidden className="size-3.5" />
            {s.back}
          </Link>
        }
        title={trip.name}
        description={info}
        actions={
          attend && !trip.trip ? (
            <Button
              disabled={start.isPending}
              onClick={() =>
                trip.blocked.length > 0
                  ? setReasonFor(true)
                  : start.mutate({ routeId }, { onSuccess: refresh })
              }
            >
              <Play aria-hidden className="size-4" />
              {d.start}
            </Button>
          ) : running && attend && trip.trip ? (
            <div className="flex flex-wrap gap-2">
              <SosButton
                institutionId={id}
                tripId={trip.trip.id}
                where={() => trip.trip?.lastSeen ?? null}
                onSent={() => {
                  setMessage(t.sos.sent);
                  refresh();
                }}
              />
              <Button onClick={() => setEnding(true)}>
                <ShieldCheck aria-hidden className="size-4" />
                {s.end}
              </Button>
            </div>
          ) : null
        }
      >
        {!trip.trip ? (
          <Pill>{s.notStarted}</Pill>
        ) : trip.trip.endedAt ? (
          <Pill tone={trip.trip.checkOutcome === 'child_found' ? 'stop' : 'go'}>
            {trip.trip.checkOutcome === 'child_found'
              ? d.childFound(trip.trip.endedAt)
              : d.endedEmpty(trip.trip.endedAt)}
          </Pill>
        ) : (
          <Pill tone="warn">{d.running(trip.trip.startedAt)}</Pill>
        )}
      </PageHeader>

      <PendingBanner />
      {(problem || start.error) && (
        <p
          role="alert"
          className="rounded-lg bg-signal-stop-tint px-4 py-3 text-body text-signal-stop-ink"
        >
          {problem ?? errorText(start.error)}
        </p>
      )}

      {/* Drop trips begin at school: everyone boards there. */}
      {!pickup && (
        <Section title={s.atSchool} description={s.boardHere} flush>
          {tiles(everyone, ['boarded', 'not_boarded'], (r) => stateOf(r) !== 'dropped')}
        </Section>
      )}
      {trip.stops.map((stop) => (
        <Section key={stop.stopId} title={`${stop.plannedAt} · ${stop.name}`} flush>
          {pickup
            ? tiles(stop.riders, ['boarded', 'not_boarded'])
            : tiles(
                stop.riders,
                ['dropped', 'nobody_at_stop'],
                (r) => stateOf(r) === 'on_board' || stateOf(r) === 'dropped',
              )}
        </Section>
      ))}

      {canTap && onBoard.length > 0 && (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => void tap(onBoard, 'handed_to_school', s.handedOver(onBoard.length))}
          >
            {s.handOver(onBoard.length)}
          </Button>
        </div>
      )}

      {ending && trip.trip && (
        <EndTrip
          institutionId={id}
          tripId={trip.trip.id}
          onClose={() => setEnding(false)}
          onEnded={() => {
            setEnding(false);
            setMessage(s.ended);
            refresh();
          }}
        />
      )}
      {reasonFor && (
        <StartWithReason
          institutionId={id}
          route={trip}
          onClose={() => {
            setReasonFor(false);
            refresh();
          }}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

/** The empty-bus check. "Empty" needs nobody still marked on board; "child found" needs a note. */
function EndTrip({
  institutionId,
  tripId,
  onClose,
  onEnded,
}: {
  institutionId: string;
  tripId: string;
  onClose: () => void;
  onEnded: () => void;
}) {
  const [outcome, setOutcome] = useState<'empty' | 'child_found' | null>(null);
  const [note, setNote] = useState('');
  const end = useMutation({
    mutationFn: () =>
      api.post(`/transport/trips/${tripId}/end`, {
        institutionId,
        outcome,
        ...(note.trim() ? { note } : {}),
      }),
    onSuccess: onEnded,
  });
  return (
    <FormModal
      title={s.endTitle}
      description={s.endBody}
      submitLabel={s.end}
      cancelLabel={t.cancel}
      pending={end.isPending}
      submitDisabled={!outcome || (outcome === 'child_found' && note.trim().length < 3)}
      error={end.error ? errorText(end.error) : null}
      tone={outcome === 'child_found' ? 'danger' : 'primary'}
      size="md"
      onClose={onClose}
      onSubmit={() => end.mutate()}
    >
      <fieldset className="col-span-full flex flex-col gap-2">
        <legend className="mb-2 text-caption font-medium text-ink">{s.outcome}</legend>
        {(['empty', 'child_found'] as const).map((k) => (
          <label
            key={k}
            className={cx(
              'flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-body text-ink',
              outcome === k ? 'border-navy-950 bg-navy-50' : 'border-line hover:bg-paper',
            )}
          >
            <input
              type="radio"
              name="outcome"
              checked={outcome === k}
              onChange={() => setOutcome(k)}
            />
            {k === 'empty' ? s.empty : s.childFound}
          </label>
        ))}
      </fieldset>
      {outcome === 'child_found' && (
        <ModalField label={s.note} hint={s.noteHint} wide>
          <textarea
            className={fieldInput}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </ModalField>
      )}
    </FormModal>
  );
}
