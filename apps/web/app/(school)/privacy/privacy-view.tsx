'use client';

// Campus Core › Privacy & Consent (rule book §13.12, §15, §16.5): the Data Protection Officer's
// console. Coverage per purpose with notices by version; data-rights requests on a clock; the
// breach register with the CERT-In 6-hour check.
import type {
  BreachRow,
  BreachStep,
  NoticeRow,
  PrivacyOverview,
  RightsRequestRow,
} from '@campusverse/platform-consent';
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
import {
  AlertTriangle,
  FileText,
  Inbox,
  KeyRound,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Siren,
} from 'lucide-react';
import { useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';
import { CaseAccess } from './case-access';
import { useUrlTab } from '../common/url-tab';

const t = en.privacy;
type View = 'coverage' | 'notices' | 'requests' | 'breaches' | 'cases';
type RequestView = 'open' | 'overdue' | 'closed';
const KINDS = ['access', 'correction', 'erasure', 'grievance', 'nomination', 'withdraw_consent'];
const LANGS = ['en', 'hi', 'te', 'ta', 'kn', 'ml'];
const TARGET_DAYS = 30;

const fmt = (iso: string, time = false) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(time ? { hour: 'numeric', minute: '2-digit' } : {}),
    timeZone: 'Asia/Kolkata',
  }).format(new Date(iso));
const purposeName = (p: string) => t.purposes[p]?.[0] ?? p.replaceAll('_', ' ');
const errorText = (e: unknown): string =>
  (e instanceof ApiFailure
    ? e.status === 403
      ? t.errors.forbidden
      : (t.errors[e.code] ?? t.errors.error)
    : t.errors.error) ?? '';
/** A datetime-local value in India time, for "now" defaults. */
const localNow = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16);
/** datetime-local (India time) to an ISO instant. */
const toInstant = (local: string) => new Date(`${local}:00+05:30`).toISOString();

function QueryState({ q }: { q: { isPending: boolean; error: unknown } }) {
  if (q.isPending) return <SkeletonRows rows={5} label={en.states.loading.title} />;
  if (q.error instanceof ApiFailure && q.error.status === 403)
    return (
      <StatePanel kind="denied" title={en.states.denied.title} body={t.errors.forbidden ?? ''} />
    );
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    return (
      <StatePanel kind="offline" title={en.states.offline.title} body={en.states.offline.body} />
    );
  return <StatePanel kind="error" title={en.states.error.title} />;
}

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['privacy-overview', 'privacy-notices', 'privacy-requests', 'privacy-breaches'])
      void qc.invalidateQueries({ queryKey: [k] });
  };
}

export function PrivacyView() {
  const { can } = useMe();
  const manage = can('platform.privacy.manage');
  const [view, setView] = useUrlTab<View>(
    ['coverage', 'notices', 'requests', 'breaches', 'cases'],
    'coverage',
  );
  const [publishing, setPublishing] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [breaching, setBreaching] = useState(false);
  const [granting, setGranting] = useState(false);
  const overview = useQuery({
    queryKey: ['privacy-overview'],
    queryFn: () => api.get<PrivacyOverview>('/privacy/overview'),
  });
  const o = overview.data;
  const refresh = useRefresh();
  const action =
    view === 'requests' ? (
      <Button onClick={() => setRecording(true)} disabled={!manage}>
        <Plus aria-hidden />
        {t.newRequest}
      </Button>
    ) : view === 'cases' ? (
      <Button onClick={() => setGranting(true)} disabled={!manage}>
        <KeyRound aria-hidden />
        {t.cases.grant}
      </Button>
    ) : view === 'breaches' ? (
      <Button onClick={() => setBreaching(true)} disabled={!manage}>
        <Siren aria-hidden />
        {t.newBreach}
      </Button>
    ) : (
      <Button onClick={() => setPublishing('')} disabled={!can('platform.consent.publish_notice')}>
        <Plus aria-hidden />
        {t.coverageTable.publish}
      </Button>
    );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={ShieldCheck}
        area="navy"
        eyebrow={en.systems.groups.core}
        title={t.title}
        description={t.lead}
        actions={o ? action : undefined}
      />
      {overview.error ? (
        <QueryState q={overview} />
      ) : (
        <>
          <KeyFigures
            label={t.figures}
            loading={!o}
            figures={[
              {
                label: t.fig.guardians,
                icon: ShieldCheck,
                value: o ? `${o.guardians.verified}/${o.guardians.total}` : '–',
                ...(o && o.guardians.verified < o.guardians.total ? { tone: 'warn' as const } : {}),
              },
              { label: t.fig.openRequests, icon: Inbox, value: String(o?.openRequests ?? '–') },
              {
                label: t.fig.overdue,
                icon: AlertTriangle,
                value: String(o?.overdueRequests ?? '–'),
                ...(o?.overdueRequests ? { tone: 'warn' as const } : {}),
              },
              {
                label: t.fig.breaches,
                icon: ShieldAlert,
                value: String(o?.openBreaches ?? '–'),
                ...(o?.lateBreaches ? { tone: 'warn' as const } : {}),
              },
            ]}
          />
          <Segmented
            label={t.tabsLabel}
            value={view}
            onChange={setView}
            options={(['coverage', 'notices', 'requests', 'breaches', 'cases'] as const).map(
              (v) => ({
                value: v,
                label: t.views[v],
              }),
            )}
          />
          {view === 'coverage' &&
            (o ? <Coverage overview={o} onPublish={setPublishing} /> : <QueryState q={overview} />)}
          {view === 'notices' && <Notices onPublish={setPublishing} />}
          {view === 'requests' && <Requests manage={manage} />}
          {view === 'breaches' && <Breaches manage={manage} />}
          {view === 'cases' && (
            <CaseAccess manage={manage} granting={granting} onGranting={setGranting} />
          )}
          <p className="text-caption text-ink-muted">{t.legalNote}</p>
        </>
      )}
      {publishing !== null && (
        <NoticeForm
          purpose={publishing}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublishing(null);
            refresh();
          }}
        />
      )}
      {recording && (
        <RequestForm
          onClose={() => setRecording(false)}
          onDone={() => {
            setRecording(false);
            setView('requests');
            refresh();
          }}
        />
      )}
      {breaching && (
        <BreachForm
          onClose={() => setBreaching(false)}
          onDone={() => {
            setBreaching(false);
            setView('breaches');
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Coverage({
  overview,
  onPublish,
}: {
  overview: PrivacyOverview;
  onPublish: (purpose: string) => void;
}) {
  const c = t.coverageTable;
  const students = overview.purposes[0]?.students ?? 0;
  return (
    <Section
      id="privacy-coverage"
      title={t.views.coverage}
      description={students ? t.coverageNote(students) : t.noStudents}
      flush
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-body">
          <caption className="sr-only">{t.views.coverage}</caption>
          <thead>
            <tr className="border-y border-line bg-paper text-left text-caption tracking-wide whitespace-nowrap text-ink-muted uppercase">
              <th scope="col" className="px-5 py-2 font-medium">
                {c.purpose}
              </th>
              <th scope="col" className="px-5 py-2 font-medium">
                {c.notice}
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                {c.granted}
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                {c.awaiting}
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                {c.withdrawn}
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                {c.undecided}
              </th>
              <th scope="col" className="w-48 px-5 py-2 font-medium">
                {c.coverage}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {overview.purposes.map((p) => (
              <tr key={p.purpose}>
                <th scope="row" className="px-5 py-3 text-left font-normal">
                  <span className="block font-medium text-ink">{purposeName(p.purpose)}</span>
                  <span className="block max-w-md text-caption text-ink-muted">
                    {t.purposes[p.purpose]?.[1] ?? ''}
                  </span>
                </th>
                <td className="px-5 py-3">
                  {p.latestVersion ? (
                    <span className="flex flex-col items-start gap-1">
                      <span className="text-caption text-ink">
                        {c.version(p.latestVersion, p.languages)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onPublish(p.purpose)}
                        className="text-caption font-medium text-navy-950 underline-offset-2 hover:underline"
                      >
                        {c.newVersion}
                      </button>
                    </span>
                  ) : (
                    <span className="flex flex-col items-start gap-1">
                      <Pill tone="warn">{c.noNotice}</Pill>
                      <button
                        type="button"
                        onClick={() => onPublish(p.purpose)}
                        className="text-caption font-medium text-navy-950 underline-offset-2 hover:underline"
                      >
                        {c.publish}
                      </button>
                    </span>
                  )}
                </td>
                <td className="tabular px-5 py-3 text-right text-ink">{p.granted}</td>
                <td className="tabular px-5 py-3 text-right text-ink">{p.awaitingVerification}</td>
                <td className="tabular px-5 py-3 text-right text-ink">{p.withdrawn}</td>
                <td className="tabular px-5 py-3 text-right text-ink">{p.undecided}</td>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-3">
                    <span
                      className="h-2 flex-1 overflow-hidden rounded-full bg-navy-50"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={p.percent}
                      aria-label={`${purposeName(p.purpose)} ${c.coverage}`}
                    >
                      <span
                        className="block h-full rounded-full bg-navy-950"
                        style={{ width: `${p.percent}%` }}
                      />
                    </span>
                    <span className="tabular w-10 text-right text-caption font-medium text-ink">
                      {p.percent}%
                    </span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Notices({ onPublish }: { onPublish: (purpose: string) => void }) {
  const q = useQuery({
    queryKey: ['privacy-notices'],
    queryFn: () => api.get<NoticeRow[]>('/privacy/notices'),
  });
  if (!q.data) return <QueryState q={q} />;
  if (q.data.length === 0)
    return (
      <EmptyState
        icon={FileText}
        area="navy"
        title={t.noticesEmpty}
        actions={
          <Button onClick={() => onPublish('')}>
            <Plus aria-hidden />
            {t.coverageTable.publish}
          </Button>
        }
      />
    );
  return (
    <Section id="privacy-notices" title={t.views.notices} flush>
      <ul className="divide-y divide-line">
        {q.data.map((n) => (
          <li key={n.id} className="flex flex-col gap-2 px-6 py-4">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">{purposeName(n.purpose)}</span>
              <Pill>{`v${n.version}`}</Pill>
              <Pill>{t.languages[n.language] ?? n.language}</Pill>
              <span className="text-caption text-ink-muted">{t.published(fmt(n.publishedAt))}</span>
            </span>
            <p className="max-w-3xl text-body whitespace-pre-line text-ink-muted">{n.body}</p>
            <span className="font-mono text-[11px] text-ink-muted" title="SHA-256">
              {n.bodySha256.slice(0, 16)}…
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Requests({ manage }: { manage: boolean }) {
  const [view, setView] = useState<RequestView>('open');
  const [open, setOpen] = useState<RightsRequestRow | null>(null);
  const q = useQuery({
    queryKey: ['privacy-requests', view],
    queryFn: () => api.get<RightsRequestRow[]>(`/privacy/requests?view=${view}`),
  });
  return (
    <div className="flex flex-col gap-4">
      <Segmented
        label={t.views.requests}
        value={view}
        onChange={setView}
        options={(['open', 'overdue', 'closed'] as const).map((v) => ({
          value: v,
          label: t.requestViews[v],
        }))}
      />
      {!q.data ? (
        <QueryState q={q} />
      ) : q.data.length === 0 ? (
        <EmptyState icon={Inbox} area="navy" title={t.requestsEmpty[view] ?? ''} />
      ) : (
        <Section id="privacy-requests" title={t.views.requests} flush>
          <ul className="divide-y divide-line">
            {q.data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpen(r)}
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-6 py-3 text-left hover:bg-paper"
                >
                  <span className="tabular text-caption font-semibold text-ink-muted">
                    #{r.number}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink">
                      {t.kinds[r.kind]} · {r.requesterName}
                    </span>
                    <span className="text-caption text-ink-muted">
                      {[
                        r.subject ? t.about(r.subject) : null,
                        r.closedAt ? t.closedOn(fmt(r.closedAt)) : t.due(fmt(r.dueAt)),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <Pill
                    tone={
                      r.overdue
                        ? 'stop'
                        : r.state === 'done'
                          ? 'go'
                          : r.state === 'rejected'
                            ? 'neutral'
                            : 'warn'
                    }
                  >
                    {r.overdue ? t.overdue : t.requestState[r.state]}
                  </Pill>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {open && <RequestDrawer request={open} manage={manage} onClose={() => setOpen(null)} />}
    </div>
  );
}

function RequestDrawer({
  request: r,
  manage,
  onClose,
}: {
  request: RightsRequestRow;
  manage: boolean;
  onClose: () => void;
}) {
  const refresh = useRefresh();
  const [outcome, setOutcome] = useState(r.outcome ?? '');
  const closed = r.state === 'done' || r.state === 'rejected';
  const move = useMutation({
    mutationFn: (state: RightsRequestRow['state']) =>
      api.post(`/privacy/requests/${r.id}/state`, { state, outcome: outcome.trim() || null }),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const rows: [string, string][] = [
    [t.request.received, fmt(r.receivedAt)],
    [t.request.due, fmt(r.dueAt)],
    ...(r.requesterContact ? [[t.request.contact, r.requesterContact] as [string, string]] : []),
    ...(r.subject ? [[t.about(''), r.subject] as [string, string]] : []),
  ];
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={t.request.title(r.number)}
      subtitle={`${t.kinds[r.kind]} · ${r.requesterName}`}
      closeLabel={t.request.close}
    >
      <div className="flex flex-col gap-5">
        <Pill tone={r.overdue ? 'stop' : closed ? 'go' : 'warn'}>
          {r.overdue ? t.overdue : t.requestState[r.state]}
        </Pill>
        <dl className="flex flex-col divide-y divide-line">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-2.5">
              <dt className="text-ink-muted">{k.trim()}</dt>
              <dd className="text-right font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-1.5">
          <h3 className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
            {t.request.details}
          </h3>
          <p className="text-body whitespace-pre-line text-ink">{r.details}</p>
        </div>
        {closed ? (
          <div className="flex flex-col gap-1.5">
            <h3 className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
              {t.request.outcome}
            </h3>
            <p className="text-body whitespace-pre-line text-ink">{r.outcome}</p>
          </div>
        ) : (
          manage && (
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-body font-medium text-ink">{t.request.outcome}</span>
                <textarea
                  className={cx(fieldInput, 'h-auto py-2')}
                  rows={4}
                  maxLength={4000}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                />
                <span className="text-caption text-ink-muted">{t.request.outcomeHint}</span>
              </label>
              {move.error && (
                <p role="alert" className="text-caption text-signal-stop-ink">
                  {errorText(move.error)}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {r.state === 'open' && (
                  <Button
                    variant="secondary"
                    disabled={move.isPending}
                    onClick={() => move.mutate('in_progress')}
                  >
                    {t.request.start}
                  </Button>
                )}
                <Button
                  disabled={move.isPending || !outcome.trim()}
                  onClick={() => move.mutate('done')}
                >
                  {t.request.done}
                </Button>
                <Button
                  variant="quiet"
                  disabled={move.isPending || !outcome.trim()}
                  onClick={() => move.mutate('rejected')}
                >
                  {t.request.reject}
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </RecordDrawer>
  );
}

function Breaches({ manage }: { manage: boolean }) {
  const refresh = useRefresh();
  const q = useQuery({
    queryKey: ['privacy-breaches'],
    queryFn: () => api.get<BreachRow[]>('/privacy/breaches'),
  });
  const step = useMutation({
    mutationFn: (v: { id: string; step: BreachStep }) =>
      api.post(`/privacy/breaches/${v.id}/step`, { step: v.step, at: null }),
    onSuccess: refresh,
  });
  if (!q.data) return <QueryState q={q} />;
  if (q.data.length === 0)
    return <EmptyState icon={ShieldCheck} area="navy" title={t.breachesEmpty} />;
  return (
    <Section id="privacy-breaches" title={t.views.breaches} flush>
      {step.error && (
        <p role="alert" className="px-6 pb-2 text-caption text-signal-stop-ink">
          {errorText(step.error)}
        </p>
      )}
      <ul className="divide-y divide-line">
        {q.data.map((b) => {
          const done: Record<BreachStep, string | null> = {
            cert_in: b.certInReportedAt,
            board: b.boardReportedAt,
            people: b.peopleInformedAt,
            close: b.closedAt,
          };
          const deadline = new Date(new Date(b.discoveredAt).getTime() + 6 * 36e5).toISOString();
          return (
            <li key={b.id} className="flex flex-col gap-3 px-6 py-4">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{b.title}</span>
                <Pill
                  tone={
                    b.severity === 'high' ? 'stop' : b.severity === 'medium' ? 'warn' : 'neutral'
                  }
                >
                  {t.severity[b.severity]}
                </Pill>
                {b.closedAt ? (
                  <Pill tone="go">{t.closedBreach}</Pill>
                ) : (
                  <Pill tone={b.certIn === 'late' ? 'stop' : b.certIn === 'due' ? 'warn' : 'go'}>
                    {t.certIn[b.certIn]}
                  </Pill>
                )}
              </span>
              <span className="text-caption text-ink-muted">
                {[
                  t.discovered(fmt(b.discoveredAt, true)),
                  b.affectedCount != null ? t.affected(b.affectedCount) : null,
                  !b.certInReportedAt && !b.closedAt ? t.certInDue(fmt(deadline, true)) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <p className="max-w-3xl text-body whitespace-pre-line text-ink-muted">
                {b.description}
              </p>
              <ol className="flex flex-wrap gap-2">
                {(['cert_in', 'board', 'people', 'close'] as const).map((s) =>
                  done[s] ? (
                    <li key={s}>
                      <Pill tone="go">{`${t.steps[s]} · ${fmt(done[s] ?? '', true)}`}</Pill>
                    </li>
                  ) : (
                    !b.closedAt &&
                    manage && (
                      <li key={s}>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={step.isPending}
                          onClick={() => step.mutate({ id: b.id, step: s })}
                        >
                          {t.markStep(t.steps[s] ?? s)}
                        </Button>
                      </li>
                    )
                  ),
                )}
              </ol>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------------------------

function NoticeForm({
  purpose: initial,
  onClose,
  onDone,
}: {
  purpose: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const f = t.noticeForm;
  const known = Object.keys(t.purposes);
  const [purpose, setPurpose] = useState(initial || known[0] || '');
  const [other, setOther] = useState('');
  const [language, setLanguage] = useState('en');
  const [body, setBody] = useState('');
  const key = purpose === '__other' ? other.trim() : purpose;
  const save = useMutation({
    mutationFn: () => api.post('/privacy/notices', { purpose: key, language, body }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={f.title}
      submitLabel={f.submit}
      cancelLabel={f.cancel}
      pending={save.isPending}
      submitDisabled={!/^[a-z][a-z0-9_]{1,40}$/.test(key) || body.trim().length < 20}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.purpose}>
        <select className={fieldInput} value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          {known.map((p) => (
            <option key={p} value={p}>
              {purposeName(p)}
            </option>
          ))}
          <option value="__other">{f.other}</option>
        </select>
      </ModalField>
      <ModalField label={f.language}>
        <select
          className={fieldInput}
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {LANGS.map((l) => (
            <option key={l} value={l}>
              {t.languages[l]}
            </option>
          ))}
        </select>
      </ModalField>
      {purpose === '__other' && (
        <ModalField label={f.otherPurpose} wide>
          <input
            className={fieldInput}
            value={other}
            maxLength={41}
            onChange={(e) => setOther(e.target.value.toLowerCase())}
          />
        </ModalField>
      )}
      <ModalField label={f.body} wide hint={f.bodyHint}>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={8}
          maxLength={8000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function RequestForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const f = t.requestForm;
  const [kind, setKind] = useState('access');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [receivedAt, setReceivedAt] = useState(localNow());
  const [details, setDetails] = useState('');
  const save = useMutation({
    mutationFn: () =>
      api.post('/privacy/requests', {
        kind,
        requesterName: name,
        requesterContact: contact.trim() || null,
        subjectPersonId: null,
        details,
        receivedAt: toInstant(receivedAt),
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={f.title}
      submitLabel={f.submit}
      cancelLabel={f.cancel}
      pending={save.isPending}
      submitDisabled={!name.trim() || !details.trim() || !receivedAt}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.kind}>
        <select className={fieldInput} value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.receivedAt} hint={f.target(TARGET_DAYS)}>
        <input
          type="datetime-local"
          className={fieldInput}
          value={receivedAt}
          max={localNow()}
          onChange={(e) => setReceivedAt(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.name}>
        <input
          className={fieldInput}
          value={name}
          maxLength={120}
          onChange={(e) => setName(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.contact}>
        <input
          className={fieldInput}
          value={contact}
          maxLength={160}
          onChange={(e) => setContact(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.details} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={5}
          maxLength={4000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}

function BreachForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const f = t.breachForm;
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [affected, setAffected] = useState('');
  const [discoveredAt, setDiscoveredAt] = useState(localNow());
  const save = useMutation({
    mutationFn: () =>
      api.post('/privacy/breaches', {
        title,
        description,
        severity,
        affectedCount: affected.trim() ? Number(affected) : null,
        discoveredAt: toInstant(discoveredAt),
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={f.title}
      submitLabel={f.submit}
      cancelLabel={f.cancel}
      pending={save.isPending}
      submitDisabled={
        !title.trim() ||
        !description.trim() ||
        !discoveredAt ||
        (affected.trim() !== '' && !/^\d+$/.test(affected.trim()))
      }
      error={save.error ? errorText(save.error) : null}
      size="md"
      tone="danger"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={f.titleField} wide>
        <input
          className={fieldInput}
          value={title}
          maxLength={160}
          onChange={(e) => setTitle(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.severity}>
        <select
          className={fieldInput}
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          {(['low', 'medium', 'high'] as const).map((s) => (
            <option key={s} value={s}>
              {t.severity[s]}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={f.discoveredAt}>
        <input
          type="datetime-local"
          className={fieldInput}
          value={discoveredAt}
          max={localNow()}
          onChange={(e) => setDiscoveredAt(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.affected}>
        <input
          inputMode="numeric"
          className={fieldInput}
          value={affected}
          onChange={(e) => setAffected(e.target.value)}
        />
      </ModalField>
      <ModalField label={f.description} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={5}
          maxLength={4000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}
