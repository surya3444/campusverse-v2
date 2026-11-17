'use client';

// Expenses (docs/specs/EXPENSES.md): bills with photos, approval by someone else with the budget
// position, payment with a voucher, budgets against what's committed, vendors and categories.
import type {
  BillRow,
  BillView,
  BudgetPosition,
  BudgetRow,
  Category,
  ExpenseFigures,
  Vendor,
} from '@campusverse/shared-expenses';
import {
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  RecordDrawer,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus, Receipt, Wallet, Clock, AlertTriangle } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { parseRupees, rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInline, fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { ReasonDialog } from '../reason-dialog';
import { useUrlTab } from '../common/url-tab';

const t = en.expenses;
type Tab = 'bills' | 'budgets' | 'vendors' | 'categories';
type Bill = BillRow & { position: BudgetPosition };
const MODES = Object.keys(t.modes);

const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d.slice(0, 10)}T00:00:00Z`));
const todayIso = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
/** The financial year (April–March) of a date, as 2026-27. */
const fyOf = (iso: string) => {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
const STATE_TONE: Record<string, 'neutral' | 'go' | 'warn' | 'stop'> = {
  submitted: 'warn',
  approved: 'neutral',
  paid: 'go',
  rejected: 'stop',
  cancelled: 'neutral',
};

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

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of [
      'expense-figures',
      'expense-bills',
      'expense-bill',
      'expense-budgets',
      'expense-vendors',
      'expense-categories',
    ])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

export function ExpensesView() {
  const school = useInstitution();
  const { can } = useMe();
  const setup = can('expenses.setup.manage');
  const [tab, setTab] = useUrlTab<Tab>(['bills', 'budgets', 'vendors', 'categories'], 'bills');
  const id = school.institutionId;
  const figures = useQuery({
    queryKey: ['expense-figures', id],
    queryFn: () => api.get<ExpenseFigures>(`/expenses/figures?institutionId=${id}`),
    enabled: !!id,
  });
  const current: Tab = tab === 'categories' && !setup ? 'bills' : tab;
  const f = figures.data;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Receipt}
        art="fees"
        area="go"
        eyebrow={en.nav.groups.money}
        title={t.title}
        description={t.lead}
        actions={
          <Segmented
            label={t.tabsLabel}
            value={current}
            onChange={setTab}
            options={[
              { value: 'bills' as const, label: t.tabs.bills },
              { value: 'budgets' as const, label: t.tabs.budgets },
              { value: 'vendors' as const, label: t.tabs.vendors },
              ...(setup ? [{ value: 'categories' as const, label: t.tabs.categories }] : []),
            ]}
          />
        }
      />
      {f && (
        <KeyFigures
          label={t.figures}
          figures={[
            {
              label: t.fig.committed(f.financialYear),
              icon: Wallet,
              value: rupees(f.committedPaise),
              note: t.fig.paidNote(rupees(f.paidPaise)),
            },
            {
              label: t.fig.waiting,
              icon: Clock,
              value: String(f.waiting),
              ...(f.waiting ? { note: rupees(f.waitingPaise) } : {}),
            },
            {
              label: t.fig.toPay,
              icon: Receipt,
              value: String(f.toPay),
              ...(f.toPay ? { note: rupees(f.toPayPaise) } : {}),
            },
            {
              label: t.fig.overBudget,
              icon: AlertTriangle,
              value: String(f.overBudget),
              ...(f.overBudget > 0
                ? { note: t.fig.categories(f.overBudget), tone: 'warn' as const }
                : {}),
            },
          ]}
        />
      )}
      {!id || figures.isError ? (
        <QueryState q={id ? figures : { isPending: true, error: null }} />
      ) : current === 'bills' ? (
        <Bills institutionId={id} />
      ) : current === 'budgets' ? (
        <Budgets institutionId={id} setup={setup} />
      ) : current === 'vendors' ? (
        <Vendors institutionId={id} manage={can('expenses.bill.record')} />
      ) : (
        <Categories institutionId={id} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Bills
// ---------------------------------------------------------------------------------------------

function Bills({ institutionId }: { institutionId: string }) {
  const { can } = useMe();
  const [view, setView] = useState<Exclude<BillView, 'all'>>('waiting');
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState(false);
  // My Work opens a bill directly.
  const [open, setOpen] = useState<string | null>(useSearchParams().get('bill'));
  useEffect(() => {
    const h = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  const q = useQuery({
    queryKey: ['expense-bills', institutionId, view, search],
    queryFn: () =>
      api.get<BillRow[]>(
        `/expenses/bills?institutionId=${institutionId}&view=${view}&search=${encodeURIComponent(search)}`,
      ),
  });
  const refresh = useRefresh();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Segmented
          label={t.viewsLabel}
          value={view}
          onChange={setView}
          options={(['waiting', 'to_pay', 'paid', 'closed'] as const).map((v) => ({
            value: v,
            label: t.views[v],
          }))}
        />
        <label className="flex min-w-48 flex-1 flex-col gap-1.5">
          <span className="sr-only">{t.search}</span>
          <input
            type="search"
            className={fieldInput}
            value={text}
            placeholder={t.searchHint}
            aria-label={t.search}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        {can('expenses.bill.record') && (
          <Button onClick={() => setRecording(true)}>
            <Plus aria-hidden className="size-4" />
            {t.recordBill}
          </Button>
        )}
      </div>
      {!q.data ? (
        <QueryState q={q} />
      ) : q.data.length === 0 ? (
        <EmptyState
          icon={Receipt}
          area="go"
          title={t.noBills[view] ?? ''}
          {...(view === 'waiting' ? { body: t.noBillsBody } : {})}
        />
      ) : (
        <Section id="expense-bills" title={t.views[view]} flush>
          <ul className="divide-y divide-line">
            {q.data.map((b) => (
              <li key={b.billId}>
                <button
                  type="button"
                  onClick={() => setOpen(b.billId)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-left hover:bg-paper"
                >
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink">{b.payTo}</span>
                    <span className="text-caption text-ink-muted tabular-nums">
                      {[b.category, b.description, b.billNo || null, dmy(b.billDate), b.voucherNo]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="text-body font-semibold text-ink tabular-nums">
                    {rupees(b.amountPaise)}
                  </span>
                  <Pill tone={STATE_TONE[b.state] ?? 'neutral'}>{t.state[b.state]}</Pill>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {recording && (
        <BillForm
          institutionId={institutionId}
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            setView('waiting');
            refresh();
          }}
        />
      )}
      {open && (
        <BillDrawer institutionId={institutionId} billId={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

function useCategories(institutionId: string) {
  return useQuery({
    queryKey: ['expense-categories', institutionId],
    queryFn: () => api.get<Category[]>(`/expenses/categories?institutionId=${institutionId}`),
  });
}
function useVendors(institutionId: string, search = '') {
  return useQuery({
    queryKey: ['expense-vendors', institutionId, search],
    queryFn: () =>
      api.get<Vendor[]>(
        `/expenses/vendors?institutionId=${institutionId}&search=${encodeURIComponent(search)}`,
      ),
  });
}

function BillForm({
  institutionId,
  onClose,
  onDone,
}: {
  institutionId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const cats = useCategories(institutionId);
  const vends = useVendors(institutionId);
  const [categoryId, setCategoryId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [payee, setPayee] = useState('');
  const [billNo, setBillNo] = useState('');
  const [billDate, setBillDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [tax, setTax] = useState('');
  const [file, setFile] = useState<{ fileId: string; fileName: string } | null>(null);
  const upload = useMutation({
    mutationFn: (f: File) =>
      api.upload<{ fileId: string; fileName: string }>(
        `/expenses/files?institutionId=${institutionId}`,
        f,
      ),
    onSuccess: setFile,
  });
  const amountPaise = parseRupees(amount);
  const taxPaise = tax.trim() ? parseRupees(tax) : 0;
  const save = useMutation({
    mutationFn: () =>
      api.post('/expenses/bills', {
        institutionId,
        categoryId,
        vendorId: vendorId || null,
        payee: vendorId ? '' : payee,
        billNo,
        billDate,
        description,
        amountPaise,
        taxPaise,
        fileId: file?.fileId ?? null,
      }),
    onSuccess: onDone,
  });
  const ready =
    !!categoryId &&
    (!!vendorId || !!payee.trim()) &&
    !!billDate &&
    !!description.trim() &&
    !!amountPaise &&
    taxPaise !== null &&
    taxPaise <= amountPaise &&
    !upload.isPending;
  return (
    <FormModal
      title={t.recordBillTitle}
      submitLabel={t.recordBill}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!ready}
      error={save.error ? errorText(save.error) : null}
      size="lg"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.category}>
        <select
          className={fieldInput}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="" />
          {(cats.data ?? [])
            .filter((c) => c.active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </ModalField>
      <ModalField label={t.vendor} hint={t.vendorHint}>
        <select
          className={fieldInput}
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
        >
          <option value="">{t.noVendor}</option>
          {(vends.data ?? [])
            .filter((v) => v.active)
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
        </select>
      </ModalField>
      {!vendorId && (
        <ModalField label={t.payee} wide>
          <input
            className={fieldInput}
            value={payee}
            maxLength={200}
            onChange={(e) => setPayee(e.target.value)}
          />
        </ModalField>
      )}
      <ModalField label={t.billNo} hint={t.optional}>
        <input
          className={fieldInput}
          value={billNo}
          maxLength={50}
          onChange={(e) => setBillNo(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.billDate}>
        <input
          type="date"
          className={fieldInput}
          value={billDate}
          max={todayIso()}
          onChange={(e) => setBillDate(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.description} wide>
        <input
          className={fieldInput}
          value={description}
          maxLength={500}
          onChange={(e) => setDescription(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.amount} hint={amount && !amountPaise ? t.badAmount : t.amountHint}>
        <input
          className={cx(fieldInput, 'tabular-nums')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.tax} hint={tax && taxPaise === null ? t.badAmount : t.optional}>
        <input
          className={cx(fieldInput, 'tabular-nums')}
          inputMode="decimal"
          value={tax}
          onChange={(e) => setTax(e.target.value)}
        />
      </ModalField>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <span className="text-caption font-medium text-ink">{t.file}</span>
        {file ? (
          <p className="flex items-center gap-3 text-body text-ink">
            {t.uploaded(file.fileName)}
            <Button size="sm" variant="secondary" type="button" onClick={() => setFile(null)}>
              {t.removeFile}
            </Button>
          </p>
        ) : upload.isPending && upload.variables ? (
          <p role="status" className="text-caption text-ink-muted">
            {t.uploading(upload.variables.name)}
          </p>
        ) : (
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-line-strong px-3 py-2 text-body text-ink hover:bg-paper focus-within:outline focus-within:outline-2 focus-within:outline-navy-950">
            <Paperclip aria-hidden className="size-4" />
            {t.addFile}
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) upload.mutate(f);
              }}
            />
          </label>
        )}
        {upload.isError && (
          <p role="alert" className="text-caption text-signal-stop-ink">
            {upload.error instanceof ApiFailure && t.errors[upload.error.code]
              ? t.errors[upload.error.code]
              : t.uploadFailed}
          </p>
        )}
      </div>
    </FormModal>
  );
}

function Position({ p }: { p: BudgetPosition }) {
  if (p.budgetPaise === null) return <p className="text-caption text-ink-muted">{t.noBudget}</p>;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-caption text-ink-muted tabular-nums">
        {t.budgetLine(rupees(p.budgetPaise), rupees(p.committedPaise))}
      </p>
      <p
        className={cx(
          'text-body tabular-nums',
          p.over ? 'font-semibold text-signal-warn-ink' : 'text-ink',
        )}
      >
        {p.over ? t.overAfter(rupees(-(p.leftPaise ?? 0))) : t.afterThis(rupees(p.leftPaise ?? 0))}
      </p>
    </div>
  );
}

function BillDrawer({
  institutionId,
  billId,
  onClose,
}: {
  institutionId: string;
  billId: string;
  onClose: () => void;
}) {
  const { can, data: me } = useMe();
  const refresh = useRefresh();
  const [rejecting, setRejecting] = useState(false);
  const [paying, setPaying] = useState(false);
  const q = useQuery({
    queryKey: ['expense-bill', institutionId, billId],
    queryFn: () => api.get<Bill>(`/expenses/bills/${billId}?institutionId=${institutionId}`),
  });
  const act = useMutation({
    mutationFn: (what: 'approve' | 'cancel') =>
      what === 'approve'
        ? api.post(`/expenses/bills/${billId}/decide`, { institutionId, approve: true, note: '' })
        : api.post(`/expenses/bills/${billId}/cancel`, { institutionId }),
    onSuccess: refresh,
  });
  const b = q.data;
  const mine = !!b && !!me && b.recordedById === me.personId;
  return (
    <>
      <RecordDrawer
        open={!rejecting && !paying}
        onOpenChange={(o) => !o && onClose()}
        title={b ? `${b.payTo} · ${rupees(b.amountPaise)}` : t.title}
        {...(b ? { subtitle: `${b.category} · ${t.state[b.state]}` } : {})}
        closeLabel={t.close}
      >
        {!b ? (
          <QueryState q={q} />
        ) : (
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-body">
              <dt className="text-ink-muted">{t.description}</dt>
              <dd className="text-ink">{b.description}</dd>
              {b.billNo && (
                <>
                  <dt className="text-ink-muted">{t.billNo}</dt>
                  <dd className="text-ink">{b.billNo}</dd>
                </>
              )}
              <dt className="text-ink-muted">{t.billDate}</dt>
              <dd className="text-ink">{dmy(b.billDate)}</dd>
              {b.taxPaise > 0 && (
                <>
                  <dt className="text-ink-muted">{t.tax}</dt>
                  <dd className="text-ink tabular-nums">{rupees(b.taxPaise)}</dd>
                </>
              )}
            </dl>
            {b.fileId && (
              <a
                className="w-fit text-body font-medium text-navy-950 underline"
                href={`/api/v1/expenses/bills/${b.billId}/file?institutionId=${institutionId}`}
                target="_blank"
                rel="noreferrer"
              >
                {t.openFile}
              </a>
            )}
            <section aria-label={t.budgetTitle} className="rounded-lg border border-line p-4">
              <h3 className="mb-2 text-caption font-semibold text-ink">{t.budgetTitle}</h3>
              <Position p={b.position} />
            </section>
            <ul className="flex flex-col gap-1 text-caption text-ink-muted">
              <li>{t.recordedBy(b.recordedBy ?? '', dmy(b.createdAt))}</li>
              {b.decidedBy && (
                <li>
                  {t.decidedBy(b.decidedBy, b.state !== 'rejected')}
                  {b.decisionNote ? `: ${b.decisionNote}` : ''}
                </li>
              )}
              {b.voucherNo && b.mode && b.paidOn && (
                <li className="tabular-nums">
                  {t.paidWith(b.voucherNo, t.modes[b.mode] ?? b.mode, dmy(b.paidOn))}
                  {b.reference ? ` · ${b.reference}` : ''}
                </li>
              )}
            </ul>
            {act.isError && (
              <p role="alert" className="text-caption text-signal-stop-ink">
                {errorText(act.error)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {b.state === 'submitted' && b.approval?.status === 'pending' && (
                <p className="w-full text-caption text-ink-muted">
                  {en.workflow.progress(
                    b.approval.step,
                    b.approval.steps,
                    b.approval.stepRoleName ?? en.workflow.anyApprover,
                  )}
                </p>
              )}
              {b.state === 'submitted' && b.approval?.mine && (
                <>
                  <Button disabled={act.isPending} onClick={() => act.mutate('approve')}>
                    {t.approve}
                  </Button>
                  <Button variant="secondary" onClick={() => setRejecting(true)}>
                    {t.reject}
                  </Button>
                </>
              )}
              {b.state === 'submitted' && mine && (
                <p className="text-caption text-ink-muted">{t.ownBill}</p>
              )}
              {b.state === 'approved' && can('expenses.bill.pay') && (
                <Button onClick={() => setPaying(true)}>{t.pay}</Button>
              )}
              {b.state === 'submitted' && (mine || can('expenses.bill.approve')) && (
                <Button
                  variant="secondary"
                  disabled={act.isPending}
                  onClick={() => act.mutate('cancel')}
                >
                  {t.cancelBill}
                </Button>
              )}
            </div>
          </div>
        )}
      </RecordDrawer>
      {rejecting && b && (
        <ReasonDialog
          title={`${t.reject}: ${b.payTo} ${rupees(b.amountPaise)}`}
          hint={t.rejectHint}
          label={t.note}
          action={t.reject}
          cancel={t.cancel}
          minLength={3}
          errorText={errorText}
          onClose={() => setRejecting(false)}
          submit={async (note) => {
            await api.post(`/expenses/bills/${billId}/decide`, {
              institutionId,
              approve: false,
              note,
            });
            refresh();
          }}
        />
      )}
      {paying && b && (
        <PayForm
          institutionId={institutionId}
          bill={b}
          onClose={() => setPaying(false)}
          onDone={() => {
            setPaying(false);
            refresh();
          }}
        />
      )}
    </>
  );
}

function PayForm({
  institutionId,
  bill,
  onClose,
  onDone,
}: {
  institutionId: string;
  bill: Bill;
  onClose: () => void;
  onDone: () => void;
}) {
  const [mode, setMode] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso());
  const save = useMutation({
    mutationFn: () =>
      api.post<{ voucherNo: string }>(`/expenses/bills/${bill.billId}/pay`, {
        institutionId,
        mode,
        reference,
        paidOn,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.payTitle(bill.payTo, rupees(bill.amountPaise))}
      submitLabel={t.pay}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!paidOn || (mode !== 'cash' && !reference.trim())}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.mode}>
        <select className={fieldInput} value={mode} onChange={(e) => setMode(e.target.value)}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {t.modes[m]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.paidOn}>
        <input
          type="date"
          className={fieldInput}
          value={paidOn}
          min={bill.billDate}
          max={todayIso()}
          onChange={(e) => setPaidOn(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.reference} hint={t.referenceHint} wide>
        <input
          className={fieldInput}
          value={reference}
          maxLength={100}
          disabled={mode === 'cash'}
          onChange={(e) => setReference(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------------------------

function Budgets({ institutionId, setup }: { institutionId: string; setup: boolean }) {
  const current = fyOf(todayIso());
  const start = Number(current.slice(0, 4));
  const years = [start + 1, start, start - 1, start - 2].map(
    (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`,
  );
  const [fy, setFy] = useState(current);
  const [editing, setEditing] = useState<BudgetRow | null>(null);
  const refresh = useRefresh();
  const q = useQuery({
    queryKey: ['expense-budgets', institutionId, fy],
    queryFn: () =>
      api.get<{ financialYear: string; rows: BudgetRow[] }>(
        `/expenses/budgets?institutionId=${institutionId}&financialYear=${fy}`,
      ),
  });
  const cols = t.budgetCols;
  return (
    <Section
      id="expense-budgets"
      title={t.tabs.budgets}
      description={t.budgetLead}
      flush
      actions={
        <label className="flex items-center gap-2 text-caption text-ink">
          {t.year}
          <select className={fieldInline} value={fy} onChange={(e) => setFy(e.target.value)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      }
    >
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="border-b border-line text-left text-caption text-ink-muted">
                <th scope="col" className="px-5 py-2 font-medium">
                  {cols.category}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {cols.budget}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {cols.committed}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {cols.paid}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {cols.waiting}
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  {cols.left}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {q.data.rows.map((r) => (
                <tr key={r.categoryId}>
                  <th scope="row" className="px-5 py-2.5 text-left font-normal text-ink">
                    <span className="flex flex-wrap items-center gap-2">
                      {r.category}
                      {r.over && <Pill tone="warn">{t.over}</Pill>}
                    </span>
                    {setup && (
                      <button
                        type="button"
                        className="text-caption font-medium text-navy-950 underline"
                        onClick={() => setEditing(r)}
                      >
                        {t.setBudget}
                        <span className="sr-only"> {r.category}</span>
                      </button>
                    )}
                  </th>
                  <td className="px-3 py-2.5 text-right text-ink">
                    {r.budgetPaise === null ? t.noBudgetShort : rupees(r.budgetPaise)}
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink">{rupees(r.committedPaise)}</td>
                  <td className="px-3 py-2.5 text-right text-ink">{rupees(r.paidPaise)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-muted">
                    {r.waitingPaise ? rupees(r.waitingPaise) : ''}
                  </td>
                  <td
                    className={cx(
                      'px-3 py-2.5 text-right',
                      r.over ? 'font-semibold text-signal-warn-ink' : 'text-ink',
                    )}
                  >
                    {r.leftPaise === null ? '' : rupees(r.leftPaise)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <BudgetForm
          institutionId={institutionId}
          row={editing}
          financialYear={fy}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function BudgetForm({
  institutionId,
  row,
  financialYear,
  onClose,
  onDone,
}: {
  institutionId: string;
  row: BudgetRow;
  financialYear: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState(
    row.budgetPaise === null ? '' : String(row.budgetPaise / 100),
  );
  const paise = parseRupees(amount);
  const save = useMutation({
    mutationFn: () =>
      api.put('/expenses/budgets', {
        institutionId,
        categoryId: row.categoryId,
        financialYear,
        amountPaise: paise,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={t.setBudgetTitle(row.category, financialYear)}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={paise === null}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.amount} hint={amount && paise === null ? t.badAmount : undefined} wide>
        <input
          className={cx(fieldInput, 'tabular-nums')}
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

// ---------------------------------------------------------------------------------------------
// Vendors and categories
// ---------------------------------------------------------------------------------------------

function Vendors({ institutionId, manage }: { institutionId: string; manage: boolean }) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null);
  const refresh = useRefresh();
  useEffect(() => {
    const h = setTimeout(() => setSearch(text.trim()), 250);
    return () => clearTimeout(h);
  }, [text]);
  const q = useVendors(institutionId, search);
  return (
    <Section
      id="expense-vendors"
      title={t.tabs.vendors}
      flush
      actions={
        manage ? (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus aria-hidden className="size-4" />
            {t.addVendor}
          </Button>
        ) : undefined
      }
    >
      <div className="border-b border-line px-5 py-3">
        <input
          type="search"
          className={fieldInput}
          value={text}
          aria-label={t.search}
          placeholder={t.search}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : q.data.length === 0 ? (
        <EmptyState compact icon={Receipt} title={t.noVendors} body={t.noVendorsBody} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-body text-ink">
                  {v.name}
                  {!v.active && <Pill>{t.off}</Pill>}
                </span>
                <span className="text-caption text-ink-muted tabular-nums">
                  {[v.gstin, v.phone?.replace(/^\+91/, ''), v.email, t.billsCount(v.bills)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              {manage && (
                <Button size="sm" variant="secondary" onClick={() => setEditing(v)}>
                  {t.edit}
                  <span className="sr-only"> {v.name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <VendorForm
          institutionId={institutionId}
          vendor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function VendorForm({
  institutionId,
  vendor,
  onClose,
  onDone,
}: {
  institutionId: string;
  vendor: Vendor | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(vendor?.name ?? '');
  const [phone, setPhone] = useState(vendor?.phone?.replace(/^\+91/, '') ?? '');
  const [email, setEmail] = useState(vendor?.email ?? '');
  const [gstin, setGstin] = useState(vendor?.gstin ?? '');
  const [address, setAddress] = useState(vendor?.address ?? '');
  const [active, setActive] = useState(vendor?.active ?? true);
  const body = {
    institutionId,
    name,
    phone: phone.trim() || null,
    email: email.trim() || null,
    gstin: gstin.trim() || null,
    address,
    active,
  };
  const save = useMutation({
    mutationFn: () =>
      vendor
        ? api.put(`/expenses/vendors/${vendor.id}`, body)
        : api.post('/expenses/vendors', body),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={vendor ? t.editVendor : t.addVendor}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.vendorName} wide>
        <input
          className={fieldInput}
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.gstin} hint={t.optional}>
        <input
          className={cx(fieldInput, 'uppercase')}
          value={gstin}
          maxLength={15}
          onChange={(e) => setGstin(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.phone} hint={t.optional}>
        <input
          className={fieldInput}
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.email} hint={t.optional}>
        <input
          className={fieldInput}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </ModalField>
      <ModalField label={t.address} hint={t.optional}>
        <input
          className={fieldInput}
          value={address}
          maxLength={500}
          onChange={(e) => setAddress(e.target.value)}
        />
      </ModalField>
      {vendor && (
        <label className="flex items-center gap-2 text-body text-ink sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t.active}
        </label>
      )}
    </FormModal>
  );
}

function Categories({ institutionId }: { institutionId: string }) {
  const q = useCategories(institutionId);
  const refresh = useRefresh();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  return (
    <Section
      id="expense-categories"
      title={t.tabs.categories}
      description={t.categoriesLead}
      flush
      actions={
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden className="size-4" />
          {t.addCategory}
        </Button>
      }
    >
      {!q.data ? (
        <div className="p-5">
          <QueryState q={q} />
        </div>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((c) => (
            <li key={c.id} className="flex items-center gap-4 px-5 py-2.5">
              <span className="flex flex-1 items-center gap-2 text-body text-ink">
                {c.name}
                {!c.active && <Pill>{t.off}</Pill>}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>
                {t.edit}
                <span className="sr-only"> {c.name}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && (
        <CategoryForm
          institutionId={institutionId}
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
    </Section>
  );
}

function CategoryForm({
  institutionId,
  category,
  onClose,
  onDone,
}: {
  institutionId: string;
  category: Category | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [active, setActive] = useState(category?.active ?? true);
  const save = useMutation({
    mutationFn: () =>
      category
        ? api.put(`/expenses/categories/${category.id}`, { institutionId, name, active })
        : api.post('/expenses/categories', { institutionId, name, active }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={category ? t.editCategory : t.addCategory}
      submitLabel={t.save}
      cancelLabel={t.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.categoryName} wide>
        <input
          className={fieldInput}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      {category && (
        <label className="flex items-center gap-2 text-body text-ink sm:col-span-2">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          {t.active}
        </label>
      )}
    </FormModal>
  );
}
