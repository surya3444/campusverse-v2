'use client';

// The library (docs/specs/LIBRARY.md): the desk (issue and return by accession number), the
// catalogue with copies, overdue books and the rules for loans and fines.
import type {
  Borrower,
  BorrowerLoans,
  CopyRow,
  LibrarySettings,
  OverdueRow,
  TitleRow,
} from '@campusverse/shared-library';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, BookUp, AlertTriangle, IndianRupee } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { ReasonDialog } from '../reason-dialog';

const t = en.library;
type View = 'desk' | 'catalogue' | 'overdue' | 'settings';
type Figures = {
  titles: number;
  copies: number;
  onLoan: number;
  overdue: number;
  owedPaise: number;
};

const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

function QueryState({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

export function LibraryView() {
  const school = useInstitution();
  const { can } = useMe();
  const manage = can('library.book.manage');
  const [view, setView] = useState<View>('desk');
  const id = school.institutionId;
  const figures = useQuery({
    queryKey: ['library-figures', id],
    queryFn: () => api.get<Figures>(`/library/figures?institutionId=${id}`),
    enabled: !!id,
  });
  const current: View = manage ? view : view === 'desk' || view === 'settings' ? 'catalogue' : view;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={BookOpen}
        art="exams"
        area="amber"
        eyebrow={en.nav.groups.services}
        title={t.title}
        description={t.lead}
        actions={
          <Segmented
            label={t.tabsLabel}
            value={current}
            onChange={setView}
            options={[
              ...(manage ? [{ value: 'desk' as const, label: t.tabs.desk }] : []),
              { value: 'catalogue' as const, label: t.tabs.catalogue },
              { value: 'overdue' as const, label: t.tabs.overdue },
              ...(manage ? [{ value: 'settings' as const, label: t.tabs.settings }] : []),
            ]}
          />
        }
      />
      {figures.data && (
        <KeyFigures
          label={t.figures}
          figures={[
            { label: t.fig.copies, icon: BookOpen, value: String(figures.data.copies) },
            { label: t.fig.onLoan, icon: BookUp, value: String(figures.data.onLoan) },
            {
              label: t.fig.overdue,
              icon: AlertTriangle,
              value: String(figures.data.overdue),
              ...(figures.data.overdue > 0 ? { tone: 'warn' as const } : {}),
            },
            { label: t.fig.owed, icon: IndianRupee, value: rupees(figures.data.owedPaise) },
          ]}
        />
      )}
      {!id || figures.isError ? (
        <QueryState q={id ? figures : { isPending: true, error: null }} />
      ) : current === 'desk' ? (
        <Desk institutionId={id} />
      ) : current === 'catalogue' ? (
        <Catalogue institutionId={id} manage={manage} />
      ) : current === 'overdue' ? (
        <Overdue institutionId={id} manage={manage} />
      ) : (
        <Settings institutionId={id} />
      )}
    </div>
  );
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of [
      'library-figures',
      'library-titles',
      'library-copies',
      'library-overdue',
      'library-borrower',
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

function Desk({ institutionId }: { institutionId: string }) {
  const refresh = useRefresh();
  const [log, setLog] = useState<{ text: string; warn: boolean }[]>([]);
  const note = (text: string, warn = false) =>
    setLog((cur) => [{ text, warn }, ...cur].slice(0, 6));
  const [issueNo, setIssueNo] = useState('');
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [who, setWho] = useState<Borrower | null>(null);
  const [returnNo, setReturnNo] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  const found = useQuery({
    queryKey: ['library-borrowers', institutionId, query],
    queryFn: () =>
      api.get<Borrower[]>(
        `/library/borrowers?institutionId=${institutionId}&text=${encodeURIComponent(query)}`,
      ),
    enabled: query.length >= 2 && !who,
  });
  const issue = useMutation({
    mutationFn: () =>
      api.post<{ title: string; borrower: string; dueOn: string; overdue: number }>(
        '/library/issue',
        {
          institutionId,
          accessionNo: issueNo,
          personId: who?.personId,
        },
      ),
    onSuccess: (r) => {
      note(
        `${t.issued(r.title, r.borrower, dmy(r.dueOn))}${r.overdue ? ` ${t.issuedOverdue(r.overdue)}` : ''}`,
        r.overdue > 0,
      );
      setIssueNo('');
      refresh();
    },
  });
  const give = useMutation({
    mutationFn: () =>
      api.post<{ title: string; borrower: string; daysLate: number; finePaise: number }>(
        '/library/return',
        {
          institutionId,
          accessionNo: returnNo,
        },
      ),
    onSuccess: (r) => {
      note(
        `${t.returned(r.title, r.borrower)}${r.daysLate > 0 ? ` ${t.returnedLate(r.daysLate, r.finePaise ? rupees(r.finePaise) : '')}` : ''}`,
        r.daysLate > 0,
      );
      setReturnNo('');
      refresh();
    },
  });
  const onIssue = (e: FormEvent) => {
    e.preventDefault();
    if (issueNo.trim() && who) issue.mutate();
  };
  const onReturn = (e: FormEvent) => {
    e.preventDefault();
    if (returnNo.trim()) give.mutate();
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Section id="library-issue" title={t.issue}>
          <form onSubmit={onIssue} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.borrower}</span>
              {who ? (
                <span className="flex items-center gap-3 rounded-lg border border-line-strong px-3 py-2">
                  <span className="min-w-0 flex-1 text-body text-ink">
                    {who.name}
                    <span className="block text-caption text-ink-muted">
                      {[
                        who.kind === 'staff' ? t.staff : null,
                        who.label,
                        t.holds(who.onLoan, who.overdue),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <Button size="sm" variant="secondary" type="button" onClick={() => setWho(null)}>
                    {t.cancel}
                  </Button>
                </span>
              ) : (
                <input
                  className={fieldInput}
                  value={text}
                  autoComplete="off"
                  onChange={(e) => setText(e.target.value)}
                  aria-describedby="borrower-hint"
                />
              )}
              {!who && (
                <span id="borrower-hint" className="text-caption text-ink-muted">
                  {t.borrowerHint}
                </span>
              )}
            </label>
            {!who && query.length >= 2 && found.data && (
              <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
                {found.data.length === 0 ? (
                  <li className="px-3 py-2 text-body text-ink-muted">{t.noBorrowers}</li>
                ) : (
                  found.data.map((b) => (
                    <li key={b.personId}>
                      <button
                        type="button"
                        onClick={() => setWho(b)}
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper"
                      >
                        <span className="text-body text-ink">{b.name}</span>
                        <span className="text-caption text-ink-muted">
                          {[
                            b.kind === 'staff' ? t.staff : null,
                            b.label,
                            t.holds(b.onLoan, b.overdue),
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.accession}</span>
              <input
                className={fieldInput}
                value={issueNo}
                autoComplete="off"
                onChange={(e) => setIssueNo(e.target.value)}
                aria-describedby="issue-hint"
              />
              <span id="issue-hint" className="text-caption text-ink-muted">
                {t.accessionHint}
              </span>
            </label>
            {issue.isError && (
              <p role="alert" className="text-caption text-signal-stop-ink">
                {errorText(issue.error)}
              </p>
            )}
            <Button
              type="submit"
              disabled={!who || !issueNo.trim() || issue.isPending}
              className="self-start"
            >
              {t.issueButton}
            </Button>
          </form>
        </Section>
        <Section id="library-return" title={t.returnTitle}>
          <form onSubmit={onReturn} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{t.accession}</span>
              <input
                className={fieldInput}
                value={returnNo}
                autoComplete="off"
                onChange={(e) => setReturnNo(e.target.value)}
                aria-describedby="return-hint"
              />
              <span id="return-hint" className="text-caption text-ink-muted">
                {t.accessionHint}
              </span>
            </label>
            {give.isError && (
              <p role="alert" className="text-caption text-signal-stop-ink">
                {errorText(give.error)}
              </p>
            )}
            <Button
              type="submit"
              disabled={!returnNo.trim() || give.isPending}
              className="self-start"
            >
              {t.returnButton}
            </Button>
          </form>
        </Section>
      </div>
      {log.length > 0 && (
        <div role="status">
          <ul className="panel flex flex-col divide-y divide-line">
            {log.map((l, i) => (
              <li
                key={`${i}-${l.text}`}
                className={cx(
                  'px-5 py-2.5 text-body',
                  l.warn ? 'text-signal-warn-ink' : 'text-ink',
                )}
              >
                {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {who && <BorrowerPanel institutionId={institutionId} borrower={who} />}
    </div>
  );
}

function LoanLine({ l }: { l: BorrowerLoans['open'][number] }) {
  return (
    <span className="text-caption text-ink-muted tabular-nums">
      {[
        l.accessionNo,
        l.returnedOn ? null : t.due(dmy(l.dueOn)),
        l.daysLate > 0 ? t.late(l.daysLate) : null,
        l.outcome === 'lost' ? t.lostTag : null,
        l.finePaise > 0
          ? l.fineState === 'waived'
            ? t.waived
            : t.fine(rupees(l.finePaise))
          : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

function BorrowerPanel({ institutionId, borrower }: { institutionId: string; borrower: Borrower }) {
  const refresh = useRefresh();
  const [waiving, setWaiving] = useState<string | null>(null);
  const loans = useQuery({
    queryKey: ['library-borrower', institutionId, borrower.personId],
    queryFn: () =>
      api.get<BorrowerLoans>(
        `/library/borrowers/${borrower.personId}?institutionId=${institutionId}`,
      ),
  });
  if (!loans.data) return <QueryState q={loans} />;
  const owed = loans.data.past.filter((l) => l.fineState === 'owed');
  return (
    <Section
      title={t.borrowerLoans(borrower.name)}
      description={loans.data.owedPaise > 0 ? t.owed(rupees(loans.data.owedPaise)) : undefined}
      flush
    >
      <ul className="divide-y divide-line">
        {loans.data.open.length === 0 && (
          <li className="px-5 py-3 text-body text-ink-muted">{t.nothingOut}</li>
        )}
        {[...loans.data.open, ...owed].map((l) => (
          <li key={l.loanId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body text-ink">{l.title}</span>
              <LoanLine l={l} />
            </span>
            {l.fineState === 'owed' && (
              <Button size="sm" variant="secondary" onClick={() => setWaiving(l.loanId)}>
                {t.waive}
                <span className="sr-only"> {l.title}</span>
              </Button>
            )}
          </li>
        ))}
      </ul>
      {waiving && (
        <ReasonDialog
          title={t.waiveTitle}
          hint={t.waiveHint}
          label={t.reason}
          action={t.waive}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setWaiving(null)}
          submit={async (reason) => {
            await api.post(`/library/loans/${waiving}/waive`, { institutionId, reason });
            setWaiving(null);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function Catalogue({ institutionId, manage }: { institutionId: string; manage: boolean }) {
  const refresh = useRefresh();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    const h = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  const titles = useQuery({
    queryKey: ['library-titles', institutionId, search],
    queryFn: () =>
      api.get<TitleRow[]>(
        `/library/titles?institutionId=${institutionId}&search=${encodeURIComponent(search)}`,
      ),
  });
  return (
    <Section
      title={t.tabs.catalogue}
      flush
      actions={
        manage ? (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            {t.addTitle}
          </Button>
        ) : undefined
      }
    >
      <div className="px-5 pb-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-ink">{t.search}</span>
          <input
            type="search"
            className={fieldInput}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="search-hint"
          />
          <span id="search-hint" className="text-caption text-ink-muted">
            {t.searchHint}
          </span>
        </label>
      </div>
      {!titles.data ? (
        <div className="p-5">
          <QueryState q={titles} />
        </div>
      ) : titles.data.length === 0 ? (
        search ? (
          <EmptyState compact art="search" title={t.noMatch} />
        ) : (
          <EmptyState art="exams" title={t.noTitles} body={t.noTitlesBody} />
        )
      ) : (
        <ul className="divide-y divide-line">
          {titles.data.map((x) => (
            <li key={x.id} className="flex flex-col">
              <button
                type="button"
                aria-expanded={open === x.id}
                onClick={() => setOpen(open === x.id ? null : x.id)}
                className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-3 text-left hover:bg-paper"
              >
                <span className="min-w-0 flex-1 text-body font-medium text-ink">
                  {x.title}
                  <span className="block text-caption font-normal text-ink-muted">
                    {[x.authors, x.subject, x.shelf ? `${t.shelf} ${x.shelf}` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="text-caption text-ink-muted tabular-nums">
                  {t.copiesCount(x.copies, x.available)}
                </span>
              </button>
              {open === x.id && (
                <Copies
                  institutionId={institutionId}
                  title={x}
                  manage={manage}
                  onChanged={refresh}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <TitleForm
          institutionId={institutionId}
          onClose={() => setAdding(false)}
          onDone={(id) => {
            setAdding(false);
            setOpen(id);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function Copies({
  institutionId,
  title,
  manage,
  onChanged,
}: {
  institutionId: string;
  title: TitleRow;
  manage: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [withdrawing, setWithdrawing] = useState<CopyRow | null>(null);
  const copies = useQuery({
    queryKey: ['library-copies', title.id],
    queryFn: () =>
      api.get<CopyRow[]>(`/library/titles/${title.id}/copies?institutionId=${institutionId}`),
  });
  const found = useMutation({
    mutationFn: (copyId: string) => api.post(`/library/copies/${copyId}/found`, { institutionId }),
    onSuccess: onChanged,
  });
  return (
    <div className="flex flex-col gap-2 bg-paper px-5 py-3">
      {!copies.data ? (
        <QueryState q={copies} />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {copies.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body">
              <span className="w-28 font-medium text-ink tabular-nums">{c.accessionNo}</span>
              <Pill
                tone={c.status === 'available' ? 'go' : c.status === 'on_loan' ? 'warn' : 'neutral'}
              >
                {t.statuses[c.status]}
              </Pill>
              <span className="min-w-0 flex-1 text-caption text-ink-muted">
                {c.loan
                  ? t.lentTo(c.loan.borrower, dmy(c.loan.dueOn))
                  : c.status === 'withdrawn'
                    ? c.note
                    : ''}
              </span>
              {manage && c.status === 'available' && (
                <Button size="sm" variant="secondary" onClick={() => setWithdrawing(c)}>
                  {t.withdraw}
                  <span className="sr-only"> {c.accessionNo}</span>
                </Button>
              )}
              {manage && c.status === 'lost' && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={found.isPending}
                  onClick={() => found.mutate(c.id)}
                >
                  {t.found}
                  <span className="sr-only"> {c.accessionNo}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {manage && (
        <Button
          size="sm"
          variant="secondary"
          className="self-start"
          onClick={() => setAdding(true)}
        >
          <Plus aria-hidden className="size-4" />
          {t.addCopies}
          <span className="sr-only"> {title.title}</span>
        </Button>
      )}
      {adding && (
        <CopiesForm
          institutionId={institutionId}
          title={title}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
        />
      )}
      {withdrawing && (
        <ReasonDialog
          title={t.withdrawTitle(withdrawing.accessionNo)}
          hint={t.withdrawHint}
          label={t.reason}
          action={t.withdraw}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setWithdrawing(null)}
          submit={async (reason) => {
            await api.post(`/library/copies/${withdrawing.id}/withdraw`, { institutionId, reason });
            setWithdrawing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function TitleForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [f, setF] = useState({
    title: '',
    authors: '',
    isbn: '',
    publisher: '',
    year: '',
    subject: '',
    language: '',
    shelf: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((c) => ({ ...c, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/library/titles', {
        institutionId,
        ...f,
        isbn: f.isbn.trim() || null,
        year: f.year ? Number(f.year) : null,
      }),
    onSuccess: (r) => onDone(r.id),
  });
  const fields: [keyof typeof f, string, boolean][] = [
    ['title', t.titleLabel, true],
    ['authors', t.authors, true],
    ['isbn', t.isbn, false],
    ['publisher', t.publisher, false],
    ['year', t.year, false],
    ['subject', t.subject, false],
    ['language', t.language, false],
    ['shelf', t.shelf, false],
  ];
  return (
    <FormModal
      title={t.addTitle}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!f.title.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {fields.map(([k, label, wide]) => (
        <ModalField key={k} label={label} wide={wide}>
          <input
            className={fieldInput}
            value={f[k]}
            onChange={set(k)}
            {...(k === 'year' ? { inputMode: 'numeric' as const, maxLength: 4 } : {})}
          />
        </ModalField>
      ))}
    </FormModal>
  );
}

function CopiesForm({
  institutionId,
  title,
  onClose,
  onDone,
}: {
  institutionId: string;
  title: TitleRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [count, setCount] = useState('1');
  const [nos, setNos] = useState('');
  const [acquiredOn, setAcquiredOn] = useState('');
  const [price, setPrice] = useState('');
  const n = Math.min(50, Math.max(1, Number(count) || 1));
  const next = useQuery({
    queryKey: ['library-next', institutionId, n],
    queryFn: () =>
      api.get<string[]>(`/library/accessions/next?institutionId=${institutionId}&count=${n}`),
  });
  useEffect(() => {
    if (next.data) setNos(next.data.join('\n'));
  }, [next.data]);
  const list = nos
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const save = useMutation({
    mutationFn: () =>
      api.post(`/library/titles/${title.id}/copies`, {
        institutionId,
        accessionNos: list,
        acquiredOn: acquiredOn || null,
        pricePaise: price ? Math.round(Number(price) * 100) : null,
      }),
    onSuccess: onDone,
  });
  const taken =
    save.error instanceof ApiFailure && save.error.code === 'accession_taken'
      ? ((save.error.details as { taken?: string[] } | null)?.taken ?? [])
      : [];
  return (
    <FormModal
      title={t.addCopiesTitle(title.title)}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={list.length === 0 || (price !== '' && !(Number(price) >= 0))}
      error={
        save.error ? `${errorText(save.error)}${taken.length ? ` ${taken.join(', ')}` : ''}` : null
      }
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.howMany}>
        <input
          className={fieldInput}
          inputMode="numeric"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.acquiredOn}>
        <input
          type="date"
          className={fieldInput}
          value={acquiredOn}
          onChange={(e) => setAcquiredOn(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.accessionNos} hint={t.accessionNosHint} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2 font-mono')}
          rows={Math.min(8, Math.max(2, list.length))}
          value={nos}
          onChange={(e) => setNos(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.price} hint={t.priceHint}>
        <input
          className={fieldInput}
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function Overdue({ institutionId, manage }: { institutionId: string; manage: boolean }) {
  const refresh = useRefresh();
  const [losing, setLosing] = useState<OverdueRow | null>(null);
  const rows = useQuery({
    queryKey: ['library-overdue', institutionId],
    queryFn: () => api.get<OverdueRow[]>(`/library/overdue?institutionId=${institutionId}`),
  });
  const act = useMutation({
    mutationFn: (a: { kind: 'renew' | 'return'; row: OverdueRow }) =>
      a.kind === 'renew'
        ? api.post(`/library/loans/${a.row.loanId}/renew`, { institutionId })
        : api.post('/library/return', { institutionId, accessionNo: a.row.accessionNo }),
    onSuccess: refresh,
  });
  if (!rows.data) return <QueryState q={rows} />;
  return (
    <Section title={t.overdueTitle} flush>
      {rows.data.length === 0 ? (
        <EmptyState compact art="exams" title={t.noOverdue} />
      ) : (
        <ul className="divide-y divide-line">
          {rows.data.map((r) => (
            <li key={r.loanId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body font-medium text-ink">
                  {r.borrower}
                  <span className="font-normal text-ink-muted">
                    {' '}
                    · {r.kind === 'staff' ? t.staff : (r.label ?? '')}
                  </span>
                </span>
                <span className="text-caption text-ink-muted tabular-nums">
                  {[
                    r.title,
                    r.accessionNo,
                    t.due(dmy(r.dueOn)),
                    t.late(r.daysLate),
                    r.fineIfToday > 0 ? t.fine(rupees(r.fineIfToday)) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {manage && (
                <span className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ kind: 'renew', row: r })}
                  >
                    {t.renew}
                    <span className="sr-only"> {r.title}</span>
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setLosing(r)}>
                    {t.markLost}
                    <span className="sr-only"> {r.title}</span>
                  </Button>
                  <Button
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ kind: 'return', row: r })}
                  >
                    {t.returnButton}
                    <span className="sr-only"> {r.title}</span>
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {act.isError && (
        <p role="alert" className="px-5 pb-4 text-caption text-signal-stop-ink">
          {errorText(act.error)}
        </p>
      )}
      {losing && (
        <LostConfirm
          institutionId={institutionId}
          row={losing}
          onClose={() => setLosing(null)}
          onDone={() => {
            setLosing(null);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function LostConfirm({
  institutionId,
  row,
  onClose,
  onDone,
}: {
  institutionId: string;
  row: OverdueRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const go = useMutation({
    mutationFn: () => api.post(`/library/loans/${row.loanId}/lost`, { institutionId }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.lostTitle(row.title)}
      description={t.lostBody}
      submitLabel={t.markLost}
      cancelLabel={t.cancel}
      tone="danger"
      pending={go.isPending}
      error={go.error ? errorText(go.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => go.mutate()}
    >
      {null}
    </FormModal>
  );
}

function Settings({ institutionId }: { institutionId: string }) {
  const qc = useQueryClient();
  const s = useQuery({
    queryKey: ['library-settings', institutionId],
    queryFn: () => api.get<LibrarySettings>(`/library/settings?institutionId=${institutionId}`),
  });
  const [draft, setDraft] = useState<Record<keyof LibrarySettings, string> | null>(null);
  useEffect(() => {
    if (s.data && !draft)
      setDraft({
        studentLoanDays: String(s.data.studentLoanDays),
        staffLoanDays: String(s.data.staffLoanDays),
        studentLimit: String(s.data.studentLimit),
        staffLimit: String(s.data.staffLimit),
        renewals: String(s.data.renewals),
        finePerDayPaise: String(s.data.finePerDayPaise / 100),
      });
  }, [s.data, draft]);
  const save = useMutation({
    mutationFn: () =>
      api.put(`/library/settings?institutionId=${institutionId}`, {
        studentLoanDays: Number(draft?.studentLoanDays),
        staffLoanDays: Number(draft?.staffLoanDays),
        studentLimit: Number(draft?.studentLimit),
        staffLimit: Number(draft?.staffLimit),
        renewals: Number(draft?.renewals),
        finePerDayPaise: Math.round(Number(draft?.finePerDayPaise) * 100),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['library-settings'] }),
  });
  if (!s.data || !draft) return <QueryState q={s} />;
  const fields: [keyof LibrarySettings, string, string | undefined][] = [
    ['studentLoanDays', t.studentDays, undefined],
    ['staffLoanDays', t.staffDays, undefined],
    ['studentLimit', t.studentLimit, undefined],
    ['staffLimit', t.staffLimit, undefined],
    ['renewals', t.renewals, undefined],
    ['finePerDayPaise', t.finePerDay, t.finePerDayHint],
  ];
  return (
    <Section title={t.settingsTitle}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(([k, label, hint]) => (
            <label key={k} className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{label}</span>
              <input
                className={fieldInput}
                inputMode={k === 'finePerDayPaise' ? 'decimal' : 'numeric'}
                value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                {...(hint ? { 'aria-describedby': `${k}-hint` } : {})}
              />
              {hint && (
                <span id={`${k}-hint`} className="text-caption text-ink-muted">
                  {hint}
                </span>
              )}
            </label>
          ))}
        </div>
        <p aria-live="polite" className="text-caption">
          {save.isSuccess ? (
            <span className="text-signal-go-ink">{t.saved}</span>
          ) : save.isError ? (
            <span role="alert" className="text-signal-stop-ink">
              {errorText(save.error)}
            </span>
          ) : null}
        </p>
        <Button type="submit" disabled={save.isPending} className="self-start">
          {t.save}
        </Button>
      </form>
    </Section>
  );
}
