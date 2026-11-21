'use client';

import {
  Announcer,
  Avatar,
  Button,
  EmptyState,
  KeyFigures,
  PageHeader,
  Progress,
  StatePanel,
  cx,
} from '@campusverse/ui';
import {
  CalendarClock,
  FileCheck2,
  Globe,
  KanbanSquare,
  Plus,
  Search,
  Send,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ApiFailure } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import {
  CLOSED,
  Interest,
  NewLeadDialog,
  OPEN,
  STAGE_DOT,
  SendFormDialog,
  StagePill,
  YearPicker,
  admissionError,
  c,
  daysTo,
  relDay,
  t,
  useCounsellors,
  usePipeline,
  useYear,
  type App,
  type Lead,
} from './shared';

const select =
  'h-9 min-w-36 rounded-lg border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';

/** Filters shared by the board and the lists: search, class, owner, source, overdue only. */
export function useFilters(apps: App[]) {
  const [q, setQ] = useState('');
  const [classId, setClassId] = useState('');
  const [owner, setOwner] = useState('');
  const [source, setSource] = useState('');
  const [overdue, setOverdue] = useState(false);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return apps.filter(
      (a) =>
        (!s ||
          a.childName.toLowerCase().includes(s) ||
          a.guardianName.toLowerCase().includes(s) ||
          a.guardianPhone.includes(s.replace(/\D/g, '') || '~') ||
          (a.reference ?? '').toLowerCase().includes(s)) &&
        (!classId || a.classId === classId) &&
        (!owner || (owner === 'none' ? !a.owner : a.owner?.personId === owner)) &&
        (!source || a.source === source) &&
        (!overdue || (!!a.nextFollowUp && daysTo(a.nextFollowUp) < 0)),
    );
  }, [apps, q, classId, owner, source, overdue]);
  return {
    shown,
    state: { q, classId, owner, source, overdue },
    set: { setQ, setClassId, setOwner, setSource, setOverdue },
  };
}

export function Filters({
  f,
  classes,
  owners,
}: {
  f: ReturnType<typeof useFilters>;
  classes: { classId: string; name: string }[];
  owners: { personId: string; name: string }[];
}) {
  const { state, set } = f;
  const any = state.q || state.classId || state.owner || state.source || state.overdue;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <label className="flex h-9 w-full items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 focus-within:border-navy-950 sm:w-72">
        <Search aria-hidden className="size-4 shrink-0 text-ink-muted" />
        <input
          type="search"
          value={state.q}
          onChange={(e) => set.setQ(e.target.value)}
          placeholder={c.filters.search}
          aria-label={c.filters.search}
          className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none placeholder:text-ink-muted"
        />
      </label>
      <select
        aria-label={c.filters.class}
        value={state.classId}
        onChange={(e) => set.setClassId(e.target.value)}
        className={select}
      >
        <option value="">{c.filters.allClasses}</option>
        {classes.map((k) => (
          <option key={k.classId} value={k.classId}>
            {k.name}
          </option>
        ))}
      </select>
      <select
        aria-label={c.owner}
        value={state.owner}
        onChange={(e) => set.setOwner(e.target.value)}
        className={select}
      >
        <option value="">{c.filters.anyOwner}</option>
        <option value="none">{c.unassigned}</option>
        {owners.map((p) => (
          <option key={p.personId} value={p.personId}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        aria-label={t.source}
        value={state.source}
        onChange={(e) => set.setSource(e.target.value)}
        className={select}
      >
        <option value="">{c.filters.anySource}</option>
        {Object.entries(t.sources).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-pressed={state.overdue}
        onClick={() => set.setOverdue(!state.overdue)}
        className={cx(
          'inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-body font-medium transition-colors',
          state.overdue
            ? 'bg-navy-950 text-white'
            : 'text-navy-950 ring-1 ring-line hover:bg-navy-50',
        )}
      >
        <CalendarClock aria-hidden className="size-4" />
        {c.filters.overdue}
      </button>
      {any && (
        <button
          type="button"
          onClick={() => {
            set.setQ('');
            set.setClassId('');
            set.setOwner('');
            set.setSource('');
            set.setOverdue(false);
          }}
          className="text-body font-medium text-navy-950 hover:underline"
        >
          {c.filters.clear}
        </button>
      )}
    </div>
  );
}

const FUNNEL: { key: string; states: string[] }[] = [
  { key: 'leads', states: ['enquiry', 'contacted'] },
  { key: 'applications', states: ['applied', 'documents_pending', 'under_review'] },
  { key: 'offers', states: ['offered', 'waitlisted', 'confirmed'] },
  { key: 'enrolled', states: ['enrolled'] },
];

export function PipelineView() {
  const school = useInstitution();
  const id = school.institutionId;
  const [year, setYear] = useYear();
  const params = useSearchParams();
  const [adding, setAdding] = useState(params.has('new'));
  const [sending, setSending] = useState<Lead | null | 'new'>(null);
  const [message, setMessage] = useState<string | null>(null);
  const data = usePipeline(id, year);
  const counsellors = useCounsellors(id);
  const apps = data.data?.applications ?? [];
  const filters = useFilters(apps);

  if (school.isPending || (data.isPending && !!id))
    return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (data.isError || school.isError)
    return data.error instanceof ApiFailure && data.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={admissionError(data.error ?? school.error)}
        action={en.states.error.action}
        onAction={() => void data.refetch()}
      />
    );
  const p = data.data;
  const n = (states: string[]) => apps.filter((a) => states.includes(a.state)).length;
  const leads =
    n(['enquiry', 'contacted']) +
    n(['applied', 'documents_pending', 'under_review']) +
    n(['offered', 'waitlisted', 'confirmed', 'enrolled']);
  const open = filters.shown.filter((a) => (OPEN as readonly string[]).includes(a.state));
  const closed = filters.shown.filter((a) => (CLOSED as readonly string[]).includes(a.state));
  // Each class's places this year, taken by students already in it and families offered a seat.
  const seatClasses = (p?.classes ?? []).filter((k) => k.running || k.held > 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={KanbanSquare}
        eyebrow={en.systems.groups.enrollment}
        title={c.pipeline.title}
        description={c.pipeline.lead}
        actions={
          <>
            <Button variant="secondary" onClick={() => setSending('new')} aria-haspopup="dialog">
              <Send aria-hidden className="size-4" />
              {c.send.action}
            </Button>
            <Button onClick={() => setAdding(true)} aria-haspopup="dialog">
              <Plus aria-hidden className="size-4" />
              {c.lead.title}
            </Button>
          </>
        }
      >
        <YearPicker year={year} onChange={setYear} />
      </PageHeader>

      {!p || apps.length === 0 ? (
        <div className="panel">
          <EmptyState
            art="admissions"
            title={c.pipeline.emptyTitle(year)}
            body={c.pipeline.emptyBody}
            actions={
              <>
                <Button onClick={() => setAdding(true)}>{c.lead.title}</Button>
                <Link
                  href={`/admissions/import?year=${year}`}
                  className="inline-flex h-10 items-center rounded-lg px-4 text-body font-medium text-navy-950 hover:bg-navy-50"
                >
                  {c.imports.title}
                </Link>
              </>
            }
          />
        </div>
      ) : (
        <>
          <KeyFigures
            variant="strip"
            label={t.glance}
            figures={FUNNEL.map((f, i) => {
              const v = n(f.states);
              return {
                label: c.funnel[f.key] ?? f.key,
                value: String(v),
                ...(i === 0
                  ? { valueTone: 'navy' as const, note: c.funnelTotal(leads) }
                  : { note: c.funnelShare(leads ? Math.round((v / leads) * 100) : 0) }),
              };
            })}
          />

          <Filters f={filters} classes={p.classes} owners={counsellors.data ?? []} />

          <section aria-labelledby="board" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="board" className="font-display text-lead font-semibold text-ink">
                {t.open}
                <span className="ml-2 text-body font-normal text-ink-muted">
                  {t.openCount(open.length)}
                </span>
              </h2>
              <p className="text-caption text-ink-muted xl:hidden">{t.scrollHint}</p>
            </div>
            <div
              role="region"
              aria-label={t.open}
              tabIndex={0}
              className="-mx-4 snap-x scroll-px-4 overflow-x-auto px-4 pb-3 sm:mx-0 sm:scroll-px-0 sm:px-0"
            >
              <div className="flex gap-3">
                {OPEN.map((s) => {
                  const cards = open.filter((a) => a.state === s);
                  return (
                    <section
                      key={s}
                      aria-labelledby={`col-${s}`}
                      className="flex w-[272px] shrink-0 snap-start flex-col gap-2.5 rounded-2xl border border-line/70 bg-navy-50/50 p-2.5"
                    >
                      <h3
                        id={`col-${s}`}
                        className="flex items-center gap-2 px-1.5 pt-1 text-body font-semibold text-ink"
                      >
                        <span aria-hidden className={cx('size-2.5 rounded-full', STAGE_DOT[s])} />
                        <span className="flex-1 truncate">{t.states[s]}</span>
                        <span className="tabular rounded-full bg-surface px-2 py-0.5 text-caption font-medium text-ink-muted ring-1 ring-line">
                          {cards.length}
                        </span>
                      </h3>
                      {cards.length === 0 ? (
                        <p className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-caption text-ink-muted">
                          {t.nobodyHere}
                        </p>
                      ) : (
                        cards.map((a) => <AppCard key={a.id} a={a} />)
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-2">
            {seatClasses.length > 0 && (
              <section aria-labelledby="seats" className="panel p-5">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 id="seats" className="font-display text-body font-semibold text-ink">
                    {t.seatsTitle}
                  </h2>
                  <p className="text-caption text-ink-muted">{t.seatsLead}</p>
                </div>
                <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                  {seatClasses.map((k) => {
                    const taken = k.students + k.promised;
                    const ratio = k.capacity ? taken / k.capacity : 0;
                    return (
                      <li key={k.classId} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-body font-medium text-ink">{k.name}</span>
                          <span className="tabular text-caption text-ink-muted">
                            {ratio >= 1 ? t.full : t.seatsShort(taken, k.capacity || null)}
                          </span>
                        </div>
                        <Progress
                          value={taken}
                          max={Math.max(k.capacity, taken, 1)}
                          tone={ratio >= 1 ? 'stop' : ratio >= 0.85 ? 'warn' : 'go'}
                          label={`${k.name}: ${t.seats(taken, k.capacity || null)}`}
                        />
                        <span className="tabular text-caption text-ink-muted">
                          {t.seatFill(k.students, k.promised)}
                          {k.seats !== null && ` · ${t.intake(k.held, k.seats)}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {closed.length > 0 && (
              <section aria-labelledby="closed" className="panel overflow-hidden">
                <h2
                  id="closed"
                  className="border-b border-line px-5 py-4 font-display text-body font-semibold text-ink"
                >
                  {t.closed}
                </h2>
                <ul className="divide-y divide-line">
                  {closed.slice(0, 12).map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/admissions/${a.id}`}
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-paper"
                      >
                        <Avatar name={a.childName} size="sm" />
                        <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
                          {a.childName}
                        </span>
                        <span className="hidden text-caption text-ink-muted sm:inline">
                          {a.className}
                        </span>
                        <StagePill state={a.state} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </>
      )}

      {adding && id && p && (
        <NewLeadDialog
          institutionId={id}
          year={year}
          classes={p.classes}
          onClose={() => setAdding(false)}
          onDone={(r) => {
            setAdding(false);
            setMessage(r.message);
            if (r.sendForm) setSending(r.sendForm);
          }}
        />
      )}
      {sending && id && (
        <SendFormDialog
          institutionId={id}
          year={year}
          lead={sending === 'new' ? null : sending}
          onClose={() => setSending(null)}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

/** A family on the board: who, where they stand, what's next and who owns them. */
function AppCard({ a }: { a: App }) {
  const overdue = !!a.nextFollowUp && daysTo(a.nextFollowUp) < 0;
  const papers =
    a.papers.required > 0 && ['applied', 'documents_pending', 'under_review'].includes(a.state);
  return (
    <Link
      href={`/admissions/${a.id}`}
      className="group lift flex flex-col gap-3 rounded-xl border border-line bg-surface p-3.5 shadow-[var(--shadow-card)]"
    >
      <span className="flex items-start gap-2.5">
        <Avatar name={a.childName} size="sm" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body font-semibold text-ink group-hover:text-navy-950">
            {a.childName}
          </span>
          <span className="truncate text-caption text-ink-muted">
            {[a.className, a.reference].filter(Boolean).join(' · ')}
          </span>
        </span>
        {a.interest && <Interest value={a.interest} />}
      </span>
      {(a.sibling ||
        a.source === 'website' ||
        papers ||
        a.form ||
        a.verified ||
        a.offerExpiresOn) && (
        <span className="flex flex-wrap gap-1.5">
          {a.verified && (
            <Chip icon={FileCheck2} tone="go">
              {c.card.verified}
            </Chip>
          )}
          {papers && !a.verified && (
            <Chip
              icon={FileCheck2}
              tone={a.papers.rejected ? 'stop' : a.papers.waiting ? 'warn' : 'neutral'}
            >
              {c.card.papers(a.papers.verified, a.papers.required)}
            </Chip>
          )}
          {a.form &&
            a.state !== 'applied' &&
            ['enquiry', 'contacted', 'documents_pending'].includes(a.state) && (
              <Chip icon={Send} tone={a.form.state === 'opened' ? 'warn' : 'neutral'}>
                {c.card.form[a.form.state]}
              </Chip>
            )}
          {a.source === 'website' && <Chip icon={Globe}>{t.online}</Chip>}
          {a.sibling && (
            <Chip icon={Users} tone="go">
              {t.sibling}
            </Chip>
          )}
          {a.offerExpiresOn && a.state === 'offered' && (
            <Chip icon={CalendarClock} tone="warn">
              {c.card.offerEnds(relDay(a.offerExpiresOn))}
            </Chip>
          )}
        </span>
      )}
      <span className="flex items-center justify-between gap-2 border-t border-line pt-2.5 text-caption text-ink-muted">
        <span className="flex min-w-0 items-center gap-1.5">
          {a.owner ? (
            <>
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-navy-950 text-[10px] font-semibold text-white"
              >
                {a.owner.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="truncate">{a.owner.name.split(' ')[0]}</span>
            </>
          ) : (
            <span>{c.unassigned}</span>
          )}
        </span>
        {a.nextFollowUp ? (
          <span
            className={cx(
              'inline-flex shrink-0 items-center gap-1',
              overdue && 'font-medium text-signal-stop-ink',
            )}
          >
            <CalendarClock aria-hidden className="size-3.5" />
            {overdue ? c.card.overdue(relDay(a.nextFollowUp)) : relDay(a.nextFollowUp)}
          </span>
        ) : (
          <span className="shrink-0">{t.sources[a.source] ?? a.source}</span>
        )}
      </span>
    </Link>
  );
}

const CHIP_TONE = {
  neutral: 'bg-navy-50 text-navy-700',
  go: 'bg-signal-go-tint text-signal-go-ink',
  warn: 'bg-signal-warn-tint text-signal-warn-ink',
  stop: 'bg-signal-stop-tint text-signal-stop-ink',
} as const;

export function Chip({
  icon: Icon,
  tone = 'neutral',
  children,
}: {
  icon?: typeof Globe;
  tone?: keyof typeof CHIP_TONE;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
        CHIP_TONE[tone],
      )}
    >
      {Icon && <Icon aria-hidden className="size-3" />}
      {children}
    </span>
  );
}
