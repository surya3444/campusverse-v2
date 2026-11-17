'use client';

import type { StudentListItem } from '@campusverse/people-records';
import type { ImportPlan, Rider } from '@campusverse/shared-transport';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  PreviewCanvas,
  Section,
  SkeletonRows,
  StatePanel,
  Toolbar,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Search, Upload, UserMinus } from 'lucide-react';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { exportCsv } from '../../../lib/csv';
import { en } from '../../../messages/en';
import { fieldInline, fieldInput } from '../common/custom-fields';
import { date, errorText, riderRows, t, type Ctx } from './shared';

const r = t.riders;
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

/** Riders on this campus's routes: who, which route and stop, since when. */
export function Riders(ctx: Ctx) {
  const { institutionId, data, manageRiders } = ctx;
  const qc = useQueryClient();
  const key = ['transport-riders', institutionId];
  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<Rider[]>(`/transport/riders?institutionId=${institutionId}`),
  });
  const [route, setRoute] = useState('');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ending, setEnding] = useState<Rider | null>(null);
  const done = (m: string) => {
    void qc.invalidateQueries({ queryKey: key });
    ctx.onDone(m);
  };

  const routeName = new Map(data.routes.map((x) => [x.id, x]));
  const stopName = new Map(data.stops.map((x) => [x.id, x.name]));
  const seats = new Map(
    data.routes.map((x) => [x.id, data.vehicles.find((v) => v.id === x.vehicleId)?.seats ?? null]),
  );
  const routesWithStops = data.routes.filter((x) => x.active && x.stops.length > 0);
  const riders = list.data ?? [];
  const perRoute = (id: string) => riders.filter((x) => x.routeId === id).length;
  const q = query.trim().toLowerCase();
  const shown = riders.filter(
    (x) =>
      (!route || x.routeId === route) &&
      (!q || x.name.toLowerCase().includes(q) || (x.reference ?? '').toLowerCase().includes(q)),
  );
  const routeLabel = (id: string) => {
    const x = routeName.get(id);
    return x ? `${x.name} · ${t.routes.directions[x.direction]}` : '';
  };

  return (
    <Section
      title={t.tabs.riders}
      description={list.data ? r.count(riders.length) : undefined}
      flush
      actions={
        <span className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={shown.length === 0}
            onClick={() =>
              void exportCsv(
                'transport_riders',
                institutionId,
                r.csvName,
                r.csvHeader,
                shown.map((x) => [
                  x.reference,
                  x.name,
                  x.label,
                  routeName.get(x.routeId)?.name,
                  x.direction,
                  stopName.get(x.stopId),
                  x.from,
                ]),
              )
            }
          >
            <Download aria-hidden className="size-4" />
            {r.download}
          </Button>
          {manageRiders && routesWithStops.length > 0 && (
            <>
              <Button variant="secondary" onClick={() => setImporting(true)} aria-haspopup="dialog">
                <Upload aria-hidden className="size-4" />
                {r.import}
              </Button>
              <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
                <Plus aria-hidden className="size-4" />
                {r.add}
              </Button>
            </>
          )}
        </span>
      }
    >
      {riders.length > 0 && (
        <div className="border-b border-line px-5 py-3">
          <Toolbar count={r.count(shown.length)}>
            <label className="relative flex min-w-56 flex-1">
              <span className="sr-only">{r.search}</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
              />
              <input
                type="search"
                placeholder={r.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={cx(fieldInput, 'pl-9')}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className="sr-only">{r.routeFilter}</span>
              <select
                value={route}
                onChange={(e) => setRoute(e.target.value)}
                className={cx(fieldInline, 'min-w-44')}
              >
                <option value="">{r.allRoutes}</option>
                {data.routes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {routeLabel(x.id)}
                    {seats.get(x.id) != null
                      ? ` (${r.seatsUsed(perRoute(x.id), seats.get(x.id) ?? 0)})`
                      : ''}
                  </option>
                ))}
              </select>
            </label>
          </Toolbar>
        </div>
      )}
      {list.isPending ? (
        <div className="p-5">
          <SkeletonRows rows={4} label={en.states.loading.title} />
        </div>
      ) : list.isError ? (
        list.error instanceof ApiFailure && list.error.status === 403 ? (
          <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
        ) : (
          <StatePanel kind="error" title={en.states.error.title} />
        )
      ) : riders.length === 0 ? (
        <EmptyState
          compact
          art="transport"
          title={r.empty}
          body={routesWithStops.length === 0 ? r.needRoutes : r.emptyBody}
        />
      ) : shown.length === 0 ? (
        <EmptyState compact art="search" title={r.noMatch} />
      ) : (
        <ul className="divide-y divide-line">
          {shown.map((x) => (
            <li key={x.assignmentId} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className="flex min-w-48 flex-1 flex-col">
                <span className="text-body font-medium text-ink">{x.name}</span>
                <span className="text-caption text-ink-muted">
                  {[x.label, x.reference].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="flex min-w-48 flex-col">
                <span className="text-body text-ink">{routeLabel(x.routeId)}</span>
                <span className="text-caption text-ink-muted">
                  {stopName.get(x.stopId)} · {r.since(date(x.from))}
                  {x.until && ` · ${r.until(date(x.until))}`}
                </span>
              </span>
              {manageRiders && !x.until && (
                <button
                  type="button"
                  onClick={() => setEnding(x)}
                  aria-haspopup="dialog"
                  aria-label={`${r.end}: ${x.name}, ${routeLabel(x.routeId)}`}
                  title={r.end}
                  className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-signal-stop-tint hover:text-signal-stop-ink"
                >
                  <UserMinus aria-hidden className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <AddRider
          ctx={ctx}
          onClose={() => setAdding(false)}
          onDone={() => (setAdding(false), done(r.added))}
        />
      )}
      {ending && (
        <EndRider
          institutionId={institutionId}
          rider={ending}
          route={routeLabel(ending.routeId)}
          onClose={() => setEnding(null)}
          onDone={() => (setEnding(null), done(r.ended))}
        />
      )}
      {importing && (
        <ImportRiders
          ctx={ctx}
          onClose={() => setImporting(false)}
          onDone={(n) => (setImporting(false), done(r.imported(n)))}
        />
      )}
    </Section>
  );
}

function AddRider({ ctx, onClose, onDone }: { ctx: Ctx; onClose: () => void; onDone: () => void }) {
  const routes = ctx.data.routes.filter((x) => x.active && x.stops.length > 0);
  const stopName = new Map(ctx.data.stops.map((x) => [x.id, x.name]));
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [student, setStudent] = useState<StudentListItem | null>(null);
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const [from, setFrom] = useState(todayIso());
  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(h);
  }, [search]);
  const found = useQuery({
    queryKey: ['rider-students', ctx.institutionId, q],
    queryFn: () =>
      api.get<StudentListItem[]>(
        `/people/students?institutionId=${ctx.institutionId}&search=${encodeURIComponent(q)}`,
      ),
    enabled: q.length >= 2 && !student,
  });
  const route = routes.find((x) => x.id === routeId);
  const save = useMutation({
    mutationFn: () =>
      api.post('/transport/riders', {
        institutionId: ctx.institutionId,
        personId: student?.personId,
        routeId,
        stopId,
        from,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={r.add}
      submitLabel={r.add}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      submitDisabled={!student || !routeId || !stopId}
      error={save.isError ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={r.findStudent} wide>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setStudent(null);
          }}
          className={fieldInput}
        />
      </ModalField>
      {!student && q.length >= 2 && (
        <ul className="flex flex-col gap-1 sm:col-span-2" aria-label={r.student}>
          {(found.data ?? []).slice(0, 8).map((s) => (
            <li key={s.personId}>
              <button
                type="button"
                onClick={() => {
                  setStudent(s);
                  setSearch(s.name);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-body text-navy-950 hover:bg-navy-50"
              >
                <span>{s.name}</span>
                <span className="text-caption text-ink-muted">
                  {[s.placement, s.reference].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {student && (
        <p className="rounded-lg bg-paper px-3 py-2 text-caption text-ink-muted sm:col-span-2">
          <span className="font-medium text-ink">{student.name}</span>
          {[student.placement, student.reference].filter(Boolean).map((x) => ` · ${x}`)}
        </p>
      )}
      <ModalField label={r.route}>
        <select
          required
          value={routeId}
          onChange={(e) => {
            setRouteId(e.target.value);
            setStopId('');
          }}
          className={fieldInput}
        >
          <option value="">{r.chooseRoute}</option>
          {routes.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · {t.routes.directions[x.direction]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={r.stop}>
        <select
          required
          disabled={!route}
          value={stopId}
          onChange={(e) => setStopId(e.target.value)}
          className={fieldInput}
        >
          <option value="">{r.chooseStop}</option>
          {route?.stops.map((s) => (
            <option key={s.stopId} value={s.stopId}>
              {s.plannedAt} · {stopName.get(s.stopId)}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={r.from} hint={r.fromHint}>
        <input
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

function EndRider({
  institutionId,
  rider,
  route,
  onClose,
  onDone,
}: {
  institutionId: string;
  rider: Rider;
  route: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lastDay, setLastDay] = useState(todayIso());
  const end = useMutation({
    mutationFn: () =>
      api.post(`/transport/riders/${rider.assignmentId}/end`, { institutionId, lastDay }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={`${r.end}: ${rider.name}`}
      description={route}
      size="md"
      tone="danger"
      submitLabel={r.end}
      cancelLabel={en.form.cancel}
      pending={end.isPending}
      error={end.isError ? errorText(end.error) : null}
      onClose={onClose}
      onSubmit={() => end.mutate()}
    >
      <ModalField label={r.lastDay}>
        <input
          type="date"
          required
          value={lastDay}
          onChange={(e) => setLastDay(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}

function ImportRiders({
  ctx,
  onClose,
  onDone,
}: {
  ctx: Ctx;
  onClose: () => void;
  onDone: (assigned: number) => void;
}) {
  const [text, setText] = useState('');
  const [from, setFrom] = useState(todayIso());
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const rows = useMemo(() => riderRows(text), [text]);
  const body = { institutionId: ctx.institutionId, from, rows };
  const preview = useMutation({
    mutationFn: () => api.post<ImportPlan>('/transport/riders/import/preview', body),
    onSuccess: setPlan,
  });
  const commit = useMutation({
    mutationFn: () => api.post<{ assigned: number }>('/transport/riders/import', body),
    onSuccess: (res) => onDone(res.assigned),
  });
  const routeName = new Map(ctx.data.routes.map((x) => [x.id, x]));
  const stopName = new Map(ctx.data.stops.map((x) => [x.id, x.name]));
  const readFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setText(await f.text());
  };

  if (plan) {
    const ready = plan.lines.filter((l) => !l.problem && !l.unchanged);
    return (
      <PreviewCanvas
        open
        onOpenChange={(o) => !o && setPlan(null)}
        title={r.previewTitle}
        actionLabel={r.previewAction(plan.ready)}
        changes={ready.map((l) => {
          const route = routeName.get(l.routeId ?? '');
          return r.change(
            l.name ?? l.reference,
            [l.label, l.reference].filter(Boolean).join(', '),
            route ? `${route.name} (${t.routes.directions[route.direction]})` : '',
            stopName.get(l.stopId ?? '') ?? '',
          );
        })}
        affected={[
          { label: r.ready, count: plan.ready },
          { label: r.unchanged, count: plan.lines.filter((l) => l.unchanged).length },
          { label: r.withProblems, count: plan.problems },
        ]}
        risks={[
          ...plan.overCapacity.map((o) => r.overCapacity(o.name, o.riders, o.seats)),
          ...plan.lines
            .filter((l) => l.problem)
            .map((l) => r.problem(l.row, l.reference, r.problems[l.problem ?? ''] ?? '')),
          ...(commit.isError ? [errorText(commit.error)] : []),
        ]}
        undo={r.undo}
        busy={commit.isPending}
        onConfirm={() => plan.ready > 0 && commit.mutate()}
        labels={en.preview}
      />
    );
  }
  return (
    <FormModal
      title={r.import}
      description={r.importLead}
      size="lg"
      submitLabel={r.importPreview}
      cancelLabel={en.form.cancel}
      pending={preview.isPending}
      submitDisabled={rows.length === 0}
      error={preview.isError ? errorText(preview.error) : null}
      onClose={onClose}
      onSubmit={() => preview.mutate()}
    >
      <ModalField label={r.importText} hint={rows.length ? r.count(rows.length) : r.noRows} wide>
        <textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'ADM-1024, Route 3, both, Gandhi Nagar'}
          className={cx(fieldInput, 'h-auto py-2 font-mono text-caption')}
        />
      </ModalField>
      <ModalField label={r.importFile}>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => void readFile(e)}
          className="text-body text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-navy-50 file:px-3 file:py-2 file:font-medium file:text-navy-950"
        />
      </ModalField>
      <ModalField label={r.from} hint={r.fromHint}>
        <input
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
    </FormModal>
  );
}
