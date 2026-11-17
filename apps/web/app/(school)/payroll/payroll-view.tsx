'use client';

// Payroll (docs/specs/PAYROLL.md): my payslips (every staff member), months (prepare with a
// preview, approve by a second person, record payment, bank sheet) and salaries (manage).
import type {
  StatutoryReturns,
  RunPreview,
  RunSummary,
  SalaryRow,
  StaffSalary,
  StoredSlip,
} from '@campusverse/people-payroll';
import {
  Announcer,
  Button,
  EmptyState,
  FormModal,
  KeyFigures,
  ModalField,
  PageHeader,
  Pill,
  PreviewCanvas,
  RecordDrawer,
  Section,
  Segmented,
  SkeletonRows,
  StatePanel,
  cx,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Printer, Wallet, CalendarDays, Users, IndianRupee } from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { downloadCsv } from '../../../lib/csv';
import { parseRupees, rupees } from '../../../lib/money';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { formatDate } from '../setup/shared';
import { Settlements } from './settlements';
import { Tds } from './tds';
import { useUrlTab } from '../common/url-tab';

const t = en.payroll;
type Tab = 'mine' | 'runs' | 'salaries' | 'settlements' | 'tds';
const EARNINGS = ['basic', 'da', 'hra', 'conveyance', 'special', 'other'] as const;
const DEDUCTIONS = ['pf', 'esi', 'pt', 'lwf', 'tds', 'otherDeduction'] as const;
const STATE_TONE: Record<string, Tone> = { draft: 'warn', approved: 'neutral', paid: 'go' };
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';

function QueryState({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={4} label={en.states.loading.title} />;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />;
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

export function PayrollView() {
  const school = useInstitution();
  const { can } = useMe();
  const prepare = can('payroll.run.prepare');
  const approve = can('payroll.run.approve');
  const manage = can('payroll.salary.manage');
  // Until the person picks, people who run payroll start on the months.
  // My Work opens final settlements directly.
  const [tab, setTab] = useUrlTab<Tab>(
    ['mine', 'runs', 'salaries', 'settlements', 'tds'],
    prepare || approve ? 'runs' : 'mine',
  );
  const [message, setMessage] = useState<string | null>(null);
  const id = school.institutionId ?? null;
  const tabs: Tab[] = [
    'mine',
    ...(prepare || approve ? (['runs'] as const) : []),
    ...(manage ? (['salaries'] as const) : []),
    ...(prepare ? (['settlements'] as const) : []),
    ...(prepare || approve ? (['tds'] as const) : []),
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={Wallet}
        area="go"
        eyebrow={en.systems.groups.finance}
        title={t.title}
        description={t.lead}
      >
        {tabs.length > 1 && (
          <Segmented
            label={t.title}
            value={tab}
            onChange={setTab}
            options={tabs.map((k) => ({ value: k, label: t.tabs[k] ?? k }))}
          />
        )}
      </PageHeader>
      {!id ? (
        <SkeletonRows rows={4} label={en.states.loading.title} />
      ) : tab === 'mine' ? (
        <MyPayslips institutionId={id} />
      ) : tab === 'runs' ? (
        <Runs institutionId={id} canPrepare={prepare} canApprove={approve} onMessage={setMessage} />
      ) : tab === 'settlements' ? (
        <Settlements institutionId={id} onMessage={setMessage} />
      ) : tab === 'tds' ? (
        <Tds institutionId={id} canPrepare={prepare} onMessage={setMessage} />
      ) : (
        <Salaries institutionId={id} onMessage={setMessage} />
      )}
      <Announcer message={message} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// My payslips and the payslip itself
// ---------------------------------------------------------------------------------------------

function MyPayslips({ institutionId }: { institutionId: string }) {
  const q = useQuery({
    queryKey: ['payslips-mine', institutionId],
    queryFn: () => api.get<StoredSlip[]>(`/payroll/mine?institutionId=${institutionId}`),
  });
  const [open, setOpen] = useState<StoredSlip | null>(null);
  if (!q.data) return <QueryState q={q} />;
  return (
    <Section title={t.tabs.mine ?? ''} flush>
      {q.data.length === 0 ? (
        <EmptyState icon={Wallet} area="go" title={t.noSlips} body={t.noSlipsBody} />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((s) => (
            <li key={s.runId}>
              <button
                type="button"
                onClick={() => setOpen(s)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-paper/60"
              >
                <span className="flex-1 text-body font-medium text-ink">{t.month(s.month)}</span>
                <span className="text-caption text-ink-muted">
                  {t.paidDays(s.paidHalves, s.calendarDays)}
                </span>
                <span className="tabular w-32 text-right text-body font-semibold text-ink">
                  {rupees(s.net)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <PayslipDrawer slip={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}

function PayslipDrawer({ slip, onClose }: { slip: StoredSlip; onClose: () => void }) {
  const row = (label: string, paise: number, strong = false) => (
    <div
      key={label}
      className={cx('flex items-center gap-3 py-1.5', strong && 'font-semibold text-ink')}
    >
      <span className="flex-1">{label}</span>
      <span className="tabular">{rupees(paise)}</span>
    </div>
  );
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${slip.name} · ${t.month(slip.month)}`}
      subtitle={[slip.employeeCode, slip.designation].filter(Boolean).join(' · ')}
      closeLabel={en.preview.close}
    >
      <div className="flex flex-col gap-5 text-body text-ink-muted">
        <div className="rounded-xl bg-paper px-4 py-3">
          <p className="text-caption">{t.net}</p>
          <p className="tabular font-display text-display font-bold text-ink">{rupees(slip.net)}</p>
          <p className="text-caption">
            {t.paidDays(slip.paidHalves, slip.calendarDays)}
            {slip.lopHalves > 0 ? ` · ${t.lop(slip.lopHalves)}` : ''}
          </p>
        </div>
        <section className="divide-y divide-line">
          <h3 className="pb-1 text-[11px] font-semibold tracking-[0.14em] uppercase">{t.gross}</h3>
          {EARNINGS.filter((k) => slip.earnings[k] > 0).map((k) =>
            row(t.earnings[k] ?? k, slip.earnings[k]),
          )}
          {slip.arrears > 0 &&
            row(t.arrears(slip.arrearsMonths.map((m) => t.month(m)).join(', ')), slip.arrears)}
          {row(t.gross, slip.gross, true)}
        </section>
        <section className="divide-y divide-line">
          <h3 className="pb-1 text-[11px] font-semibold tracking-[0.14em] uppercase">
            {t.deductions}
          </h3>
          {DEDUCTIONS.filter((k) => slip[k] > 0).map((k) => row(t.lines[k] ?? k, slip[k]))}
          {row(t.deductions, slip.gross - slip.net, true)}
        </section>
        {slip.employerPf + slip.employerEsi + slip.employerLwf > 0 && (
          <p className="text-caption">
            {t.employer}:{' '}
            <span className="tabular">
              {rupees(slip.employerPf + slip.employerEsi + slip.employerLwf)}
            </span>
          </p>
        )}
        {slip.capped && <p className="text-caption text-signal-warn-ink">{t.capped}</p>}
        <Button variant="secondary" onClick={() => window.print()} className="self-start">
          <Printer aria-hidden className="size-4" />
          {t.print}
        </Button>
      </div>
    </RecordDrawer>
  );
}

// ---------------------------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------------------------

function Runs({
  institutionId,
  canPrepare,
  canApprove,
  onMessage,
}: {
  institutionId: string;
  canPrepare: boolean;
  canApprove: boolean;
  onMessage: (m: string) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['payroll-runs', institutionId],
    queryFn: () => api.get<RunSummary[]>(`/payroll/runs?institutionId=${institutionId}`),
  });
  const [choosing, setChoosing] = useState(false);
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const ask = useMutation({
    mutationFn: (m: string) =>
      api.post<RunPreview>('/payroll/runs/preview', { institutionId, month: m }),
    onSuccess: (p) => {
      setChoosing(false);
      setPreview(p);
    },
  });
  const commit = useMutation({
    mutationFn: (m: string) =>
      api.post<{ runId: string }>('/payroll/runs', { institutionId, month: m }),
    onSuccess: (r) => {
      setPreview(null);
      onMessage(t.prepared);
      void qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      setOpen(r.runId);
    },
  });
  if (!q.data) return <QueryState q={q} />;
  const latest = q.data[0];
  return (
    <>
      {latest && (
        <KeyFigures
          label={t.title}
          figures={[
            {
              label: t.month(latest.month),
              icon: CalendarDays,
              value: t.states[latest.state] ?? latest.state,
            },
            { label: t.previewStaff, icon: Users, value: String(latest.slips) },
            { label: t.gross, icon: Wallet, value: rupees(latest.grossPaise) },
            { label: t.net, icon: IndianRupee, value: rupees(latest.netPaise) },
          ]}
        />
      )}
      <Section
        title={t.tabs.runs ?? ''}
        flush
        actions={
          canPrepare ? (
            <Button onClick={() => setChoosing(true)}>
              <Plus aria-hidden className="size-4" />
              {t.prepare}
            </Button>
          ) : undefined
        }
      >
        {q.data.length === 0 ? (
          <EmptyState art="fees" title={t.noRuns} body={t.noRunsBody} />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.runId}>
                <button
                  type="button"
                  onClick={() => setOpen(r.runId)}
                  className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-paper/60"
                >
                  <span className="min-w-40 flex-1 text-body font-medium text-ink">
                    {t.month(r.month)}
                  </span>
                  <Pill tone={STATE_TONE[r.state] ?? 'neutral'}>{t.states[r.state]}</Pill>
                  <span className="text-caption text-ink-muted">{t.staffCount(r.slips)}</span>
                  <span className="tabular w-32 text-right text-body font-semibold text-ink">
                    {rupees(r.netPaise)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {choosing && (
        <FormModal
          title={t.prepareTitle}
          submitLabel={t.prepare}
          cancelLabel={en.preview.cancel}
          pending={ask.isPending}
          error={ask.error ? errorText(ask.error) : null}
          onClose={() => setChoosing(false)}
          onSubmit={() => ask.mutate(month)}
        >
          <ModalField label={t.which}>
            <input
              type="month"
              required
              max={istToday().slice(0, 7)}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
        </FormModal>
      )}
      <PreviewCanvas
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        title={preview ? t.previewTitle(t.month(preview.month)) : ''}
        actionLabel={t.prepare}
        changes={
          preview
            ? t.previewChanges(
                preview.slips.length,
                rupees(preview.totals.netPaise),
                formatDate(preview.attendanceThrough),
              )
            : []
        }
        affected={[
          { label: t.previewStaff, count: preview?.slips.length ?? 0 },
          { label: t.previewNoSalary, count: preview?.noSalary.length ?? 0 },
        ]}
        risks={
          preview && preview.noSalary.length > 0
            ? [t.previewRisk(preview.noSalary.map((s) => s.name).join(', '))]
            : []
        }
        undo={t.previewUndo}
        busy={commit.isPending}
        labels={en.preview}
        onConfirm={() => preview && commit.mutate(preview.month)}
      />
      {open && (
        <RunDrawer
          runId={open}
          canPrepare={canPrepare}
          canApprove={canApprove}
          onClose={() => setOpen(null)}
          onMessage={onMessage}
          onRecompute={(m) => {
            setOpen(null);
            ask.mutate(m);
          }}
        />
      )}
    </>
  );
}

type RunDetail = RunSummary & { payslips: StoredSlip[] };

/** ECR file and challan totals for an approved or paid run (rule book §13.7 Payroll › Statutory). */
function Statutory({ runId }: { runId: string }) {
  const s = t.returns;
  const q = useQuery({
    queryKey: ['payroll-statutory', runId],
    queryFn: () => api.get<StatutoryReturns>(`/payroll/runs/${runId}/statutory`),
  });
  if (!q.data) return <QueryState q={q} />;
  const d = q.data;
  const rows: [string, number][] = [
    [s.pfEmployee, d.totals.pfEmployeePaise],
    [s.eps, d.totals.epsPaise],
    [s.pfDifference, d.totals.pfDifferencePaise],
    [s.esiEmployee, d.totals.esiEmployeePaise],
    [s.esiEmployer, d.totals.esiEmployerPaise],
    [s.pt, d.totals.ptPaise],
    ...(d.totals.lwfEmployeePaise + d.totals.lwfEmployerPaise > 0
      ? ([
          [s.lwfEmployee, d.totals.lwfEmployeePaise],
          [s.lwfEmployer, d.totals.lwfEmployerPaise],
        ] as [string, number][])
      : []),
    [s.tds, d.totals.tdsPaise],
  ];
  const save = (text: string, type: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  };
  const ecr = () => save(d.ecr, 'text/plain', `ECR-${d.month}.txt`);
  const esi = () => save(d.esi, 'text/csv', `ESI-${d.month}.csv`);
  return (
    <section
      aria-labelledby="statutory-title"
      className="flex flex-col gap-3 rounded-xl border border-line p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="statutory-title" className="font-display text-lead font-semibold text-ink">
            {s.title}
          </h3>
          <p className="text-caption text-ink-muted">{s.lead}</p>
        </div>
        <span className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={ecr} disabled={d.ecrMembers === 0}>
            <Download aria-hidden className="size-4" />
            {s.ecr}
          </Button>
          <Button variant="secondary" size="sm" onClick={esi} disabled={d.esiMembers === 0}>
            <Download aria-hidden className="size-4" />
            {s.esiFile}
          </Button>
        </span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map(([label, paise]) => (
          <div key={label} className="flex justify-between gap-3 py-1">
            <dt className="text-caption text-ink-muted">{label}</dt>
            <dd className="tabular text-body font-medium text-ink">{rupees(paise)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-caption text-ink-muted">
        {s.ecrCount(d.ecrMembers)} · {s.esiCount(d.esiMembers)}
      </p>
      {d.withoutIp.length > 0 && (
        <p role="status" className="text-caption text-signal-warn-ink">
          {s.withoutIp(d.withoutIp.map((x) => x.name).join(', '))}
        </p>
      )}
      {d.withoutUan.length > 0 && (
        <p role="status" className="text-caption text-signal-warn-ink">
          {s.withoutUan(d.withoutUan.map((x) => x.name).join(', '))}
        </p>
      )}
      {d.wageRule.length > 0 && (
        <p role="status" className="text-caption text-signal-warn-ink">
          {s.wageRule(d.wageRule.map((x) => x.name).join(', '))}
        </p>
      )}
      <p className="text-caption text-ink-muted">{s.note}</p>
    </section>
  );
}

function RunDrawer({
  runId,
  canPrepare,
  canApprove,
  onClose,
  onMessage,
  onRecompute,
}: {
  runId: string;
  canPrepare: boolean;
  canApprove: boolean;
  onClose: () => void;
  onMessage: (m: string) => void;
  onRecompute: (month: string) => void;
}) {
  const qc = useQueryClient();
  const me = useMe().data;
  const q = useQuery({
    queryKey: ['payroll-run', runId],
    queryFn: () => api.get<RunDetail>(`/payroll/runs/${runId}`),
  });
  const [paying, setPaying] = useState(false);
  const [paidOn, setPaidOn] = useState(istToday());
  const [mode, setMode] = useState<'bank' | 'cash' | 'cheque'>('bank');
  const [reference, setReference] = useState('');
  const [slip, setSlip] = useState<StoredSlip | null>(null);
  const done = (m: string) => {
    onMessage(m);
    void qc.invalidateQueries({ queryKey: ['payroll-runs'] });
    void q.refetch();
  };
  const approve = useMutation({
    mutationFn: () => api.post(`/payroll/runs/${runId}/approve`),
    onSuccess: () => done(t.approved),
  });
  const pay = useMutation({
    mutationFn: () =>
      api.post(`/payroll/runs/${runId}/paid`, {
        paidOn,
        mode,
        reference: reference.trim() || null,
      }),
    onSuccess: () => {
      setPaying(false);
      done(t.paid);
    },
  });
  const r = q.data;
  const download = () => {
    if (!r) return;
    const c = t.columns;
    downloadCsv(
      `payroll-${r.month}`,
      [c.name, c.code, c.days, c.gross, c.deductions, c.net],
      r.payslips.map((s) => [
        s.name,
        s.employeeCode,
        s.paidHalves / 2,
        (s.gross / 100).toFixed(2),
        ((s.gross - s.net) / 100).toFixed(2),
        (s.net / 100).toFixed(2),
      ]),
    );
  };
  const ownRun = r?.preparedBy === me?.personId;
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={r ? t.month(r.month) : t.title}
      {...(r ? { subtitle: `${t.states[r.state]} · ${t.staffCount(r.slips)}` } : {})}
      closeLabel={en.preview.close}
    >
      {!r ? (
        <QueryState q={q} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-paper px-4 py-3 text-caption text-ink-muted">
            <span>
              {t.gross}
              <br />
              <b className="tabular text-body text-ink">{rupees(r.grossPaise)}</b>
            </span>
            <span>
              {t.deductions}
              <br />
              <b className="tabular text-body text-ink">{rupees(r.grossPaise - r.netPaise)}</b>
            </span>
            <span>
              {t.net}
              <br />
              <b className="tabular text-body text-ink">{rupees(r.netPaise)}</b>
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {r.state === 'draft' && canApprove && !ownRun && (
              <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                {t.approve}
              </Button>
            )}
            {r.state === 'draft' && canPrepare && (
              <Button variant="secondary" onClick={() => onRecompute(r.month)}>
                {t.recompute}
              </Button>
            )}
            {r.state === 'approved' && canPrepare && (
              <Button onClick={() => setPaying(true)}>{t.markPaid}</Button>
            )}
            <Button variant="quiet" onClick={download}>
              <Download aria-hidden className="size-4" />
              {t.bankFile}
            </Button>
          </div>
          {r.state === 'draft' && ownRun && canApprove && (
            <p className="text-caption text-ink-muted">{t.ownRun}</p>
          )}
          {r.paidOn && (
            <p className="text-caption text-signal-go-ink">{t.paidLine(formatDate(r.paidOn))}</p>
          )}
          {r.state !== 'draft' && (canPrepare || canApprove) && <Statutory runId={runId} />}
          {(approve.error || pay.error) && (
            <p role="alert" className="text-caption text-signal-stop-ink">
              {errorText(approve.error ?? pay.error)}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr>
                  <th className="px-2 py-2 text-left">{t.columns.name}</th>
                  <th className="px-2 py-2 text-right">{t.columns.days}</th>
                  <th className="px-2 py-2 text-right">{t.columns.net}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {r.payslips.map((s) => (
                  <tr key={s.personId}>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => setSlip(s)}
                        className="text-left font-medium text-ink hover:text-navy-950 hover:underline"
                      >
                        {s.name}
                      </button>
                      <span className="block text-caption text-ink-muted">{s.employeeCode}</span>
                    </td>
                    <td className="tabular px-2 py-2 text-right text-ink-muted">
                      {s.paidHalves % 2 ? (s.paidHalves / 2).toFixed(1) : s.paidHalves / 2}
                    </td>
                    <td className="tabular px-2 py-2 text-right font-medium text-ink">
                      {rupees(s.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {paying && (
        <FormModal
          title={t.paidTitle}
          submitLabel={t.markPaid}
          cancelLabel={en.preview.cancel}
          pending={pay.isPending}
          error={pay.error ? errorText(pay.error) : null}
          onClose={() => setPaying(false)}
          onSubmit={() => pay.mutate()}
        >
          <ModalField label={t.paidOn}>
            <input
              type="date"
              required
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
          <ModalField label={t.mode}>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
              className={fieldInput}
            >
              {Object.entries(t.modes).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </ModalField>
          <ModalField label={t.reference} wide>
            <input
              maxLength={80}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className={fieldInput}
            />
          </ModalField>
        </FormModal>
      )}
      {slip && <PayslipDrawer slip={slip} onClose={() => setSlip(null)} />}
    </RecordDrawer>
  );
}

// ---------------------------------------------------------------------------------------------
// Salaries
// ---------------------------------------------------------------------------------------------

function Salaries({
  institutionId,
  onMessage,
}: {
  institutionId: string;
  onMessage: (m: string) => void;
}) {
  const q = useQuery({
    queryKey: ['payroll-salaries', institutionId],
    queryFn: () => api.get<StaffSalary[]>(`/payroll/salaries?institutionId=${institutionId}`),
  });
  const [editing, setEditing] = useState<StaffSalary | null>(null);
  if (!q.data) return <QueryState q={q} />;
  return (
    <Section title={t.tabs.salaries ?? ''} flush>
      <ul className="divide-y divide-line">
        {q.data.map((s) => (
          <li key={s.personId} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="flex min-w-48 flex-1 flex-col">
              <a
                href={`/staff/${s.personId}`}
                className="text-body font-medium text-ink hover:text-navy-950 hover:underline"
              >
                {s.name}
              </a>
              <span className="text-caption text-ink-muted">
                {[s.employeeCode, s.designation].filter(Boolean).join(' · ')}
              </span>
            </div>
            {s.estimate ? (
              <span className="tabular text-caption text-ink-muted">
                {t.estimate(rupees(s.estimate.grossPaise), rupees(s.estimate.netPaise))}
              </span>
            ) : (
              <Pill tone="warn">{t.noSalaryYet}</Pill>
            )}
            <Button
              variant={s.salary ? 'secondary' : 'primary'}
              size="sm"
              onClick={() => setEditing(s)}
            >
              {s.salary ? t.changeSalary : t.setSalary}
            </Button>
          </li>
        ))}
      </ul>
      {editing && (
        <SalaryModal
          institutionId={institutionId}
          staff={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onMessage(t.saved);
            void q.refetch();
          }}
        />
      )}
    </Section>
  );
}

const money = (paise: number | undefined) =>
  paise ? rupees(paise).replace('₹', '').replace(/\.00$/, '') : '';

function SalaryModal({
  institutionId,
  staff,
  onClose,
  onDone,
}: {
  institutionId: string;
  staff: StaffSalary;
  onClose: () => void;
  onDone: () => void;
}) {
  const s = staff.salary;
  const [from, setFrom] = useState(
    s ? istToday().slice(0, 8) + '01' : istToday().slice(0, 8) + '01',
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(
      [...EARNINGS, 'tdsPaise', 'otherDeductionPaise'].map((k) => [
        k,
        money(s?.[k as keyof SalaryRow] as number),
      ]),
    ),
  );
  const [flags, setFlags] = useState({ pf: s?.pf ?? true, esi: s?.esi ?? true, pt: s?.pt ?? true });
  const history = useQuery({
    queryKey: ['payroll-salary-history', staff.personId],
    queryFn: () =>
      api.get<SalaryRow[]>(`/payroll/salaries/${staff.personId}?institutionId=${institutionId}`),
    enabled: !!s,
  });
  const paise = (k: string) => (amounts[k]?.trim() ? parseRupees(amounts[k] ?? '') : 0);
  const bad = [...EARNINGS, 'tdsPaise', 'otherDeductionPaise'].some((k) => paise(k) === null);
  const gross = EARNINGS.reduce((a, k) => a + (paise(k) ?? 0), 0);
  // Labour Codes wage rule, as people/payroll's wageRuleShortfall: allowances above half of
  // gross count as wages (PF, gratuity). The server applies the same rule in returns and settlements.
  const shortfall = Math.max(0, Math.ceil(gross / 2) - (paise('basic') ?? 0) - (paise('da') ?? 0));
  const save = useMutation({
    mutationFn: () =>
      api.post('/payroll/salaries', {
        institutionId,
        personId: staff.personId,
        effectiveFrom: from,
        ...Object.fromEntries(EARNINGS.map((k) => [k, paise(k) ?? 0])),
        ...flags,
        tdsPaise: paise('tdsPaise') ?? 0,
        otherDeductionPaise: paise('otherDeductionPaise') ?? 0,
      }),
    onSuccess: onDone,
  });
  const input = (k: string, label: string) => (
    <ModalField key={k} label={label}>
      <input
        inputMode="decimal"
        autoComplete="off"
        value={amounts[k] ?? ''}
        onChange={(e) => setAmounts((x) => ({ ...x, [k]: e.target.value }))}
        className={cx(fieldInput, 'tabular')}
      />
    </ModalField>
  );
  return (
    <FormModal
      title={t.salaryTitle(staff.name)}
      description={t.salaryLead}
      submitLabel={t.setSalary}
      cancelLabel={en.preview.cancel}
      size="lg"
      pending={save.isPending}
      submitDisabled={bad || gross <= 0}
      error={save.error ? errorText(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={t.from}>
        <input
          type="date"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={fieldInput}
        />
      </ModalField>
      <p className="tabular self-end pb-2.5 text-body font-semibold text-ink">
        {t.gross}: {rupees(gross)}
      </p>
      {EARNINGS.map((k) => input(k, t.earnings[k] ?? k))}
      {gross > 0 && shortfall > 0 && (
        <p
          role="status"
          className="rounded-lg bg-signal-warn-tint px-3 py-2 text-caption text-signal-warn-ink sm:col-span-2"
        >
          {t.wageRuleLive(rupees(shortfall))}
        </p>
      )}
      <fieldset className="flex flex-wrap gap-4 sm:col-span-2">
        <legend className="mb-1.5 text-caption font-medium text-ink">{t.statutory}</legend>
        {(['pf', 'esi', 'pt'] as const).map((k) => (
          <label key={k} className="flex items-center gap-2 text-body text-ink">
            <input
              type="checkbox"
              checked={flags[k]}
              onChange={(e) => setFlags((f) => ({ ...f, [k]: e.target.checked }))}
            />
            {t.lines[k]}
          </label>
        ))}
      </fieldset>
      {input('tdsPaise', t.tds)}
      {input('otherDeductionPaise', t.otherDeduction)}
      {history.data && history.data.length > 0 && (
        <div className="flex flex-col gap-1 rounded-xl bg-paper px-4 py-3 text-caption text-ink-muted sm:col-span-2">
          <p className="font-medium text-ink">{t.history}</p>
          {history.data.map((h) => (
            <p key={h.id} className="tabular">
              {formatDate(h.effectiveFrom)} · {rupees(EARNINGS.reduce((a, k) => a + h[k], 0))}
            </p>
          ))}
        </div>
      )}
    </FormModal>
  );
}
