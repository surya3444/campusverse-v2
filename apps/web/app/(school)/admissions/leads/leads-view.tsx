'use client';

import type { InviteRow } from '@campusverse/school-admissions';
import {
  Announcer,
  Avatar,
  Button,
  EmptyState,
  KeyFigures,
  PageHeader,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useQuery } from '@tanstack/react-query';
import { ContactRound, NotebookPen, Plus, Send, Upload } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { useInstitution } from '../../attendance/shared';
import { useUrlTab } from '../../common/url-tab';
import { KIND_ICON, LogActivityDialog } from '../activity';
import { Filters, useFilters } from '../pipeline-view';
import {
  ContactActions,
  Interest,
  NewLeadDialog,
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
} from '../shared';

const TABS = ['active', 'open', 'closed'] as const;
const IN_TAB: Record<(typeof TABS)[number], string[]> = {
  active: ['enquiry', 'contacted'],
  open: [
    'enquiry',
    'contacted',
    'applied',
    'documents_pending',
    'under_review',
    'offered',
    'waitlisted',
    'confirmed',
  ],
  closed: ['lost', 'withdrawn', 'rejected'],
};
const asLead = (a: App): Lead => ({
  id: a.id,
  childName: a.childName,
  guardianName: a.guardianName,
  guardianPhone: a.guardianPhone,
  guardianEmail: a.guardianEmail,
});

/** Every family the school is talking to: who owns them, how warm, last contact and what's next. */
export function LeadsView() {
  const school = useInstitution();
  const id = school.institutionId;
  const [year, setYear] = useYear();
  const [tab, setTab] = useUrlTab(TABS, 'active');
  const [adding, setAdding] = useState(false);
  const [sending, setSending] = useState<Lead | null | 'new'>(null);
  const [logging, setLogging] = useState<App | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const data = usePipeline(id, year);
  const counsellors = useCounsellors(id);
  const links = useQuery({
    queryKey: ['admission-invites', id],
    queryFn: () => api.get<InviteRow[]>(`/school/admissions/${id}/invites`),
    enabled: !!id,
  });
  const all = data.data?.applications ?? [];
  const inTab = all.filter((a) => IN_TAB[tab].includes(a.state));
  const filters = useFilters(inTab);

  if (data.isError)
    return data.error instanceof ApiFailure && data.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel kind="error" title={en.states.error.title} body={admissionError(data.error)} />
    );

  const weekAgo = Date.now() - 7 * 864e5;
  const sentLinks = (links.data ?? []).filter((l) => l.purpose === 'apply' && !l.cancelledAt);
  const shown = filters.shown;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ContactRound}
        eyebrow={en.systems.groups.enrollment}
        title={c.leads.title}
        description={c.leads.lead}
        actions={
          <>
            <Link
              href={`/admissions/import?year=${year}`}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-body font-medium text-ink shadow-[var(--shadow-card)] hover:bg-navy-50"
            >
              <Upload aria-hidden className="size-4" />
              {c.imports.title}
            </Link>
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

      <KeyFigures
        variant="strip"
        label={c.leads.title}
        loading={data.isPending}
        figures={[
          {
            label: c.leads.figures.new,
            value: String(all.filter((a) => Date.parse(a.createdAt) > weekAgo).length),
            note: c.leads.figures.newNote,
            valueTone: 'navy',
          },
          {
            label: c.leads.figures.hot,
            value: String(
              all.filter((a) => a.interest === 'hot' && IN_TAB.open.includes(a.state)).length,
            ),
          },
          {
            label: c.leads.figures.overdue,
            value: String(
              all.filter(
                (a) =>
                  !!a.nextFollowUp && daysTo(a.nextFollowUp) < 0 && IN_TAB.open.includes(a.state),
              ).length,
            ),
            tone: 'warn',
          },
          {
            label: c.leads.figures.forms,
            value: `${sentLinks.filter((l) => l.submittedAt).length}/${sentLinks.length}`,
            note: c.leads.figures.formsNote(sentLinks.filter((l) => l.openedAt).length),
          },
        ]}
      />

      <section aria-labelledby="leads-table" className="panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-line px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="leads-table" className="font-display text-lead font-semibold text-ink">
              {c.leads.tabs[tab]}
              <span className="ml-2 text-body font-normal text-ink-muted">{shown.length}</span>
            </h2>
            <Segmented
              label={c.leads.title}
              value={tab}
              onChange={setTab}
              options={TABS.map((k) => ({
                value: k,
                label: c.leads.tabs[k] ?? k,
                count: all.filter((a) => IN_TAB[k].includes(a.state)).length,
              }))}
            />
          </div>
          <Filters f={filters} classes={data.data?.classes ?? []} owners={counsellors.data ?? []} />
        </div>
        {data.isPending ? (
          <SkeletonRows rows={6} label={en.states.loading.title} />
        ) : shown.length === 0 ? (
          <EmptyState
            compact
            art={inTab.length ? 'search' : 'admissions'}
            title={inTab.length ? c.leads.noMatch : c.leads.empty}
            body={inTab.length ? undefined : c.leads.emptyBody}
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-body">
                <caption className="sr-only">{c.leads.title}</caption>
                <thead>
                  <tr className="border-b border-line bg-paper/60 text-left text-caption font-medium text-ink-muted">
                    <th scope="col" className="px-5 py-3">
                      {c.leads.cols.lead}
                    </th>
                    <th scope="col" className="px-3 py-3">
                      {c.leads.cols.parent}
                    </th>
                    <th scope="col" className="px-3 py-3">
                      {c.leads.cols.source}
                    </th>
                    <th scope="col" className="px-3 py-3">
                      {c.owner}
                    </th>
                    <th scope="col" className="px-3 py-3">
                      {c.leads.cols.lastContact}
                    </th>
                    <th scope="col" className="px-3 py-3">
                      {c.leads.cols.next}
                    </th>
                    <th scope="col" className="px-3 py-3">
                      {c.leads.cols.stage}
                    </th>
                    <th scope="col" className="px-5 py-3 text-right">
                      <span className="sr-only">{c.leads.cols.actions}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {shown.map((a) => (
                    <LeadRow
                      key={a.id}
                      a={a}
                      onSend={() => setSending(asLead(a))}
                      onLog={() => setLogging(a)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y divide-line lg:hidden">
              {shown.map((a) => (
                <li key={a.id} className="flex flex-col gap-3 px-5 py-4">
                  <Link href={`/admissions/${a.id}`} className="flex items-start gap-3">
                    <Avatar name={a.childName} size="md" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-medium text-ink">{a.childName}</span>
                      <span className="text-caption text-ink-muted">
                        {a.className} · {a.guardianName}
                      </span>
                    </span>
                    <StagePill state={a.state} />
                  </Link>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-3 text-caption text-ink-muted">
                      <Interest value={a.interest} />
                      {a.nextFollowUp && (
                        <span className={cx(daysTo(a.nextFollowUp) < 0 && 'text-signal-stop-ink')}>
                          {c.leads.nextShort(relDay(a.nextFollowUp))}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <ContactActions
                        phone={a.guardianPhone}
                        email={a.guardianEmail}
                        name={a.guardianName}
                        size="sm"
                      />
                      <IconButton label={c.log.action(a.childName)} onClick={() => setLogging(a)}>
                        <NotebookPen aria-hidden className="size-4" />
                      </IconButton>
                      {['enquiry', 'contacted'].includes(a.state) && (
                        <IconButton
                          label={c.send.titleFor(a.childName)}
                          onClick={() => setSending(asLead(a))}
                        >
                          <Send aria-hidden className="size-4" />
                        </IconButton>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {adding && id && data.data && (
        <NewLeadDialog
          institutionId={id}
          year={year}
          classes={data.data.classes}
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
      {logging && (
        <LogActivityDialog
          applicationId={logging.id}
          childName={logging.childName}
          onClose={() => setLogging(null)}
          onDone={() => setMessage(c.log.saved)}
        />
      )}
      <Announcer message={message} />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong hover:text-navy-950"
    >
      {children}
    </button>
  );
}

function LeadRow({ a, onSend, onLog }: { a: App; onSend: () => void; onLog: () => void }) {
  const LastIcon = a.lastContactKind ? KIND_ICON[a.lastContactKind] : null;
  const overdue = !!a.nextFollowUp && daysTo(a.nextFollowUp) < 0;
  return (
    <tr className="group transition-colors hover:bg-navy-50/40">
      <td className="px-5 py-3">
        <Link href={`/admissions/${a.id}`} className="flex min-w-0 items-center gap-3">
          <Avatar name={a.childName} size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-medium text-ink group-hover:text-navy-950">
              {a.childName}
            </span>
            <span className="truncate text-caption text-ink-muted">
              {[a.className, a.reference].filter(Boolean).join(' · ')}
            </span>
          </span>
        </Link>
      </td>
      <td className="px-3 py-3">
        <span className="flex max-w-[200px] flex-col">
          <span className="truncate text-ink">{a.guardianName}</span>
          <span className="tabular text-caption whitespace-nowrap text-ink-muted">
            {a.guardianPhone}
          </span>
        </span>
      </td>
      <td className="px-3 py-3">
        <span className="flex flex-col whitespace-nowrap">
          <span className="text-ink">{t.sources[a.source] ?? a.source}</span>
          {a.campaign && <span className="text-caption text-ink-muted">{a.campaign}</span>}
        </span>
      </td>
      <td className="px-3 py-3">
        <span className="flex flex-col gap-0.5">
          <span className={cx(a.owner ? 'text-ink' : 'text-ink-muted')}>
            {a.owner?.name ?? c.unassigned}
          </span>
          <Interest value={a.interest} />
        </span>
      </td>
      <td className="px-3 py-3 text-caption text-ink-muted">
        {a.lastContactAt ? (
          <span className="inline-flex items-center gap-1.5">
            {LastIcon && <LastIcon aria-hidden className="size-3.5" />}
            {relDay(a.lastContactAt.slice(0, 10))}
          </span>
        ) : (
          c.leads.never
        )}
      </td>
      <td className="px-3 py-3">
        {a.nextFollowUp ? (
          <span className="flex flex-col">
            <span
              className={cx('text-body', overdue ? 'font-medium text-signal-stop-ink' : 'text-ink')}
            >
              {relDay(a.nextFollowUp)}
            </span>
            {a.nextPurpose && (
              <span className="max-w-[180px] truncate text-caption text-ink-muted">
                {a.nextPurpose}
              </span>
            )}
          </span>
        ) : (
          <span className="text-caption text-ink-muted">—</span>
        )}
      </td>
      <td className="px-3 py-3">
        <StagePill state={a.state} />
      </td>
      <td className="px-5 py-3">
        <span className="flex items-center justify-end gap-1.5">
          <ContactActions
            phone={a.guardianPhone}
            email={a.guardianEmail}
            name={a.guardianName}
            size="sm"
          />
          <IconButton label={c.log.action(a.childName)} onClick={onLog}>
            <NotebookPen aria-hidden className="size-4" />
          </IconButton>
          {['enquiry', 'contacted'].includes(a.state) && (
            <IconButton label={c.send.titleFor(a.childName)} onClick={onSend}>
              <Send aria-hidden className="size-4" />
            </IconButton>
          )}
        </span>
      </td>
    </tr>
  );
}
