'use client';

import {
  Avatar,
  EmptyState,
  KeyFigures,
  PageHeader,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { ChevronRight, FileCheck2, FileStack, Globe, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { ApiFailure } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { useUrlTab } from '../../common/url-tab';
import { Chip, Filters, useFilters } from '../pipeline-view';
import {
  StagePill,
  YearPicker,
  admissionError,
  c,
  relDay,
  shortDate,
  t,
  useCounsellors,
  usePipeline,
  useYear,
  type App,
} from '../shared';

const TABS = ['verify', 'papers', 'review', 'offers', 'waitlist', 'enrolled'] as const;
type Tab = (typeof TABS)[number];
const IN: Record<Tab, string[]> = {
  verify: ['applied'],
  papers: ['documents_pending'],
  review: ['under_review'],
  offers: ['offered', 'confirmed'],
  waitlist: ['waitlisted'],
  enrolled: ['enrolled'],
};

/** Applications from the form and the office: papers to check, review, offers and the waitlist. */
export function ApplicationsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const [year, setYear] = useYear();
  const [tab, setTab] = useUrlTab(TABS, 'verify');
  const data = usePipeline(id, year);
  const counsellors = useCounsellors(id);
  const all = data.data?.applications ?? [];
  const filters = useFilters(all.filter((a) => IN[tab].includes(a.state)));

  if (data.isError)
    return data.error instanceof ApiFailure && data.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={admissionError(data.error)} />
    );
  const count = (states: string[]) => all.filter((a) => states.includes(a.state)).length;
  const waiting = all.filter(
    (a) => ['applied', 'documents_pending'].includes(a.state) && a.papers.waiting > 0,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={FileStack}
        eyebrow={en.systems.groups.enrollment}
        title={c.apps.title}
        description={c.apps.lead}
        actions={
          <Link
            href={`/admissions/forms?year=${year}`}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
          >
            <Globe aria-hidden className="size-4" />
            {c.forms.title}
          </Link>
        }
      >
        <YearPicker year={year} onChange={setYear} />
      </PageHeader>

      <KeyFigures
        variant="strip"
        label={c.apps.title}
        loading={data.isPending}
        figures={[
          {
            label: c.apps.figures.toCheck,
            value: String(waiting),
            note: c.apps.figures.toCheckNote,
            ...(waiting ? { valueTone: 'navy' as const } : {}),
          },
          {
            label: c.apps.figures.papersNeeded,
            value: String(count(['documents_pending'])),
            tone: 'warn',
          },
          {
            label: c.apps.figures.verified,
            value: String(all.filter((a) => a.verified).length),
            tone: 'go',
          },
          {
            label: c.apps.figures.offers,
            value: String(count(['offered'])),
            note: c.apps.figures.offersNote(count(['confirmed'])),
          },
        ]}
      />

      <section aria-labelledby="apps-table" className="panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="apps-table" className="font-display text-lead font-semibold text-ink">
                {c.apps.tabs[tab]}
              </h2>
              <p className="text-caption text-ink-muted">{c.apps.tabLead[tab]}</p>
            </div>
            <Segmented
              label={c.apps.title}
              value={tab}
              onChange={setTab}
              options={TABS.map((k) => ({
                value: k,
                label: c.apps.tabs[k] ?? k,
                count: count(IN[k]),
              }))}
            />
          </div>
          <Filters f={filters} classes={data.data?.classes ?? []} owners={counsellors.data ?? []} />
        </div>
        {data.isPending ? (
          <SkeletonRows rows={6} label={en.states.loading.title} />
        ) : filters.shown.length === 0 ? (
          <EmptyState compact art="search" title={c.apps.empty[tab] ?? ''} />
        ) : (
          <ul className="divide-y divide-line">
            {filters.shown.map((a) => (
              <AppRow key={a.id} a={a} tab={tab} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AppRow({ a, tab }: { a: App; tab: Tab }) {
  const r = a.papers;
  const pct = r.required ? Math.round((r.verified / r.required) * 100) : 0;
  return (
    <li>
      <Link
        href={`/admissions/${a.id}`}
        className="group grid items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-navy-50/40 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={a.childName} size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-ink group-hover:text-navy-950">
              {a.childName}
            </span>
            <span className="truncate text-caption text-ink-muted">
              {[a.className, a.reference && c.apps.ref(a.reference), a.guardianName]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </span>
        <span className="flex flex-col text-caption text-ink-muted">
          <span className="text-body text-ink">{c.apps.since(shortDate(a.createdAt))}</span>
          <span>{a.source === 'website' ? c.apps.viaForm : (t.sources[a.source] ?? a.source)}</span>
        </span>
        <span className="flex flex-col gap-1.5">
          {a.verified ? (
            <span className="inline-flex items-center gap-1.5 text-body font-medium text-signal-go-ink">
              <ShieldCheck aria-hidden className="size-4" />
              {c.card.verified}
            </span>
          ) : (
            <>
              <span className="flex items-center justify-between gap-2 text-caption">
                <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                  <FileCheck2 aria-hidden className="size-3.5 text-ink-muted" />
                  {c.apps.papersOf(r.verified, r.required)}
                </span>
                <span className="flex gap-1">
                  {r.waiting > 0 && <Chip tone="warn">{c.apps.waiting(r.waiting)}</Chip>}
                  {r.rejected > 0 && <Chip tone="stop">{c.apps.rejected(r.rejected)}</Chip>}
                </span>
              </span>
              <span
                role="img"
                aria-label={c.apps.papersOf(r.verified, r.required)}
                className="block h-1.5 w-full overflow-hidden rounded-full bg-navy-50"
              >
                <span
                  className={cx(
                    'block h-full rounded-full',
                    r.rejected ? 'bg-signal-stop' : 'bg-signal-go',
                  )}
                  style={{ width: `${pct}%` }}
                />
              </span>
            </>
          )}
        </span>
        <span className="flex items-center justify-end gap-3">
          {tab === 'offers' && a.offerExpiresOn && a.state === 'offered' ? (
            <span className="text-caption text-signal-warn-ink">
              {c.card.offerEnds(relDay(a.offerExpiresOn))}
            </span>
          ) : (
            <StagePill state={a.state} />
          )}
          <ChevronRight
            aria-hidden
            className="size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5"
          />
        </span>
      </Link>
    </li>
  );
}
