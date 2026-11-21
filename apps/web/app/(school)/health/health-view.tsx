'use client';

// Health Connect › Health Records, Medical Visits and Emergency (rule book §13.9, §16.5). The
// nurse finds a student and works in the sealed record; management sees totals with small counts
// hidden; anyone with emergency access can open life-saving details for an hour, on the record.
import type {
  EmergencyView,
  HealthRecordView,
  HealthTotals,
  Vault,
  VisitOutcome,
  VisitRow,
} from '@campusverse/shared-health';
import {
  Button,
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
  Activity,
  AlertTriangle,
  HeartPulse,
  Search,
  ShieldAlert,
  Siren,
  Stethoscope,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { useUrlTab } from '../common/url-tab';
import { count, errorText, time, useStudentSearch, when, type Found } from './common';
import { IncidentsSection, PartnersSection } from './emergencies';
import { MedicinesSection } from './stock';
import { fieldInput } from '../common/custom-fields';
import { useMe } from '../common/me';

const t = en.health;
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const OUTCOMES: VisitOutcome[] = ['back_to_class', 'rested', 'sent_home', 'referred'];
type Tab = 'records' | 'medicines' | 'emergencies';

export function HealthView() {
  const { can } = useMe();
  const school = useInstitution();
  const id = school.institutionId ?? null;
  const medical = can('health.record.read');
  const reports = can('health.report.read');
  const emergency = can('health.emergency.open');
  const stock = can('health.stock.manage');
  const incidentsOk = can('health.emergency.manage');
  const raise = can('health.emergency.raise');
  const tabs: Tab[] = [
    'records',
    ...(stock ? (['medicines'] as const) : []),
    ...(incidentsOk ? (['emergencies'] as const) : []),
  ];
  const [tab, setTab] = useUrlTab<Tab>(['records', 'medicines', 'emergencies'], 'records');
  const shown: Tab = tabs.includes(tab) ? tab : 'records';
  const [openId, setOpenId] = useState<string | null>(null);
  const [breaking, setBreaking] = useState(false);
  const totals = useQuery({
    queryKey: ['health-totals', id],
    queryFn: () => api.get<HealthTotals>(`/health/totals?institutionId=${id}`),
    enabled: !!id && reports,
  });
  const nothing = !medical && !reports && !emergency && !stock && !incidentsOk;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={HeartPulse}
        area="rose"
        eyebrow={en.systems.groups.health}
        title={t.title}
        description={t.lead}
        actions={
          emergency || raise ? (
            <span className="flex flex-wrap gap-2">
              {raise && (
                <Link
                  href="/emergency"
                  className="inline-flex h-10 items-center gap-2 rounded-lg bg-signal-stop-ink px-4 text-body font-medium text-white shadow-[var(--shadow-button)] hover:bg-signal-stop-ink/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-950"
                >
                  <Siren aria-hidden className="size-4" />
                  {t.sos}
                </Link>
              )}
              {emergency && (
                <Button variant="secondary" onClick={() => setBreaking(true)} disabled={!id}>
                  <ShieldAlert aria-hidden />
                  {t.emergency.action}
                </Button>
              )}
            </span>
          ) : undefined
        }
      >
        {tabs.length > 1 && (
          <Segmented
            label={t.tabsLabel}
            value={shown}
            onChange={setTab}
            options={tabs.map((v) => ({ value: v, label: t.tabs[v] ?? v }))}
          />
        )}
      </PageHeader>
      {nothing ? (
        <StatePanel
          kind="denied"
          title={t.errors.forbidden ?? en.states.denied.title}
          body={t.errors.deniedBody ?? ''}
        />
      ) : shown === 'medicines' && id ? (
        <MedicinesSection institutionId={id} />
      ) : shown === 'emergencies' && id ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <IncidentsSection institutionId={id} />
          <PartnersSection institutionId={id} />
        </div>
      ) : (
        <>
          {reports &&
            (totals.error ? (
              <StatePanel kind="error" title={en.states.error.title} />
            ) : (
              <KeyFigures
                label={t.figures}
                loading={!totals.data}
                figures={[
                  {
                    label: t.fig.records,
                    icon: HeartPulse,
                    value: count(totals.data?.records ?? 0),
                  },
                  {
                    label: t.fig.allergies,
                    icon: AlertTriangle,
                    value: count(totals.data?.allergies ?? 0),
                  },
                  {
                    label: t.fig.visitsToday,
                    icon: Stethoscope,
                    value: count(totals.data?.visitsToday ?? 0),
                  },
                  {
                    label: t.fig.breakGlass,
                    icon: ShieldAlert,
                    value: String(totals.data?.breakGlassThisMonth ?? 0),
                    ...(totals.data?.breakGlassThisMonth ? { tone: 'warn' as const } : {}),
                  },
                ]}
              />
            ))}
          {medical ? (
            <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <FindStudent institutionId={id} onOpen={setOpenId} />
              <TodayVisits institutionId={id} onOpen={setOpenId} />
            </div>
          ) : (
            <p className="text-body text-ink-muted">{t.medicalOnly}</p>
          )}
        </>
      )}
      {openId && id && (
        <RecordPanel institutionId={id} studentId={openId} onClose={() => setOpenId(null)} />
      )}
      {breaking && id && <BreakGlass institutionId={id} onClose={() => setBreaking(false)} />}
    </div>
  );
}

function FindStudent({
  institutionId,
  onOpen,
}: {
  institutionId: string | null;
  onOpen: (id: string) => void;
}) {
  const [text, setText] = useState('');
  const q = useStudentSearch(institutionId, text);
  return (
    <Section id="health-find" title={t.find} description={t.findHint}>
      <label className="relative block">
        <span className="sr-only">{t.find}</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted"
        />
        <input
          className={cx(fieldInput, 'pl-9')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
      </label>
      {text.trim().length >= 2 && (
        <div className="mt-3">
          {q.isPending ? (
            <SkeletonRows rows={3} label={en.states.loading.title} />
          ) : !q.data || q.data.length === 0 ? (
            <p className="text-body text-ink-muted">{t.noMatch}</p>
          ) : (
            <ul className="-mx-2 flex flex-col">
              {q.data.slice(0, 8).map((s) => (
                <li key={s.personId}>
                  <button
                    type="button"
                    onClick={() => onOpen(s.personId)}
                    aria-label={`${t.open}: ${s.name}`}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-paper"
                  >
                    <span className="text-body text-ink">{s.name}</span>
                    {s.placement && (
                      <span className="text-caption text-ink-muted">{s.placement}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function TodayVisits({
  institutionId,
  onOpen,
}: {
  institutionId: string | null;
  onOpen: (id: string) => void;
}) {
  const q = useQuery({
    queryKey: ['health-visits', institutionId],
    queryFn: () => api.get<VisitRow[]>(`/health/visits?institutionId=${institutionId}`),
    enabled: !!institutionId,
  });
  return (
    <Section id="health-today" title={t.todayVisits} flush>
      {q.isPending ? (
        <div className="px-6 pb-5">
          <SkeletonRows rows={3} label={en.states.loading.title} />
        </div>
      ) : q.error ? (
        <div className="px-6 pb-5">
          <StatePanel kind="error" title={en.states.error.title} />
        </div>
      ) : q.data.length === 0 ? (
        <p className="px-6 pb-5 text-body text-ink-muted">{t.noVisits}</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {q.data.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onOpen(v.studentId)}
                className="flex w-full items-center gap-3 px-6 py-3 text-left hover:bg-paper"
              >
                <span className="tabular w-16 text-caption text-ink-muted">
                  {time(v.visitedAt)}
                </span>
                <span className="min-w-0 flex-1 text-body text-ink">{v.name}</span>
                <Pill tone={v.outcome === 'sent_home' || v.outcome === 'referred' ? 'warn' : 'go'}>
                  {t.outcomes[v.outcome]}
                </Pill>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function RecordPanel({
  institutionId,
  studentId,
  onClose,
}: {
  institutionId: string;
  studentId: string;
  onClose: () => void;
}) {
  const r = t.record;
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['health-record', studentId],
    queryFn: () =>
      api.get<HealthRecordView>(`/health/students/${studentId}?institutionId=${institutionId}`),
  });
  const [vault, setVault] = useState<Vault | null>(null);
  const [visiting, setVisiting] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setVault(q.data.vault);
  }, [q.data]);
  const save = useMutation({
    mutationFn: () => api.put(`/health/students/${studentId}`, { institutionId, vault }),
    onSuccess: async () => {
      setNote(r.saved);
      await qc.invalidateQueries({ queryKey: ['health-record', studentId] });
      await qc.invalidateQueries({ queryKey: ['health-totals'] });
    },
  });
  const set = (k: keyof Vault) => (value: string) =>
    setVault((v) => (v ? { ...v, [k]: k === 'bloodGroup' ? value || null : value } : v));
  const text = (k: 'allergies' | 'conditions' | 'medicines' | 'responderNotes', rows = 2) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`health-${k}`} className="text-caption font-medium text-ink">
        {r[k]}
      </label>
      <textarea
        id={`health-${k}`}
        className={cx(fieldInput, 'h-auto py-2')}
        rows={rows}
        value={vault?.[k] ?? ''}
        onChange={(e) => set(k)(e.target.value)}
        {...(k === 'responderNotes' ? { 'aria-describedby': 'health-responder-hint' } : {})}
      />
      {k === 'responderNotes' && (
        <p id="health-responder-hint" className="text-caption text-ink-muted">
          {r.responderHint}
        </p>
      )}
    </div>
  );
  return (
    <RecordDrawer
      open
      onOpenChange={(o) => !o && onClose()}
      title={q.data ? r.title(q.data.name) : r.title('')}
      subtitle={r.subtitle}
      closeLabel={r.close}
    >
      {!q.data || !vault ? (
        q.error ? (
          <StatePanel
            kind={q.error instanceof ApiFailure && q.error.status === 403 ? 'denied' : 'error'}
            title={errorText(q.error)}
          />
        ) : (
          <SkeletonRows rows={6} label={en.states.loading.title} />
        )
      ) : (
        <div className="flex flex-col gap-6">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <p className="text-caption text-ink-muted">
              {q.data.updatedAt ? r.updated(when(q.data.updatedAt)) : r.notRecorded}
            </p>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-ink">{r.bloodGroup}</span>
              <select
                className={fieldInput}
                value={vault.bloodGroup ?? ''}
                onChange={(e) => set('bloodGroup')(e.target.value)}
              >
                <option value="">{r.unknown}</option>
                {BLOOD.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
            {text('allergies')}
            {text('conditions', 3)}
            {text('medicines')}
            {text('responderNotes')}
            {save.error && (
              <p role="alert" className="text-caption text-signal-stop-ink">
                {errorText(save.error)}
              </p>
            )}
            {note && !save.isPending && (
              <p role="status" className="text-caption text-signal-go-ink">
                {note}
              </p>
            )}
            <div>
              <Button type="submit" disabled={save.isPending}>
                {r.save}
              </Button>
            </div>
          </form>

          <section aria-labelledby="health-visits-title" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3
                id="health-visits-title"
                className="font-display text-lead font-semibold text-ink"
              >
                {r.visits}
              </h3>
              <Button variant="secondary" size="sm" onClick={() => setVisiting(true)}>
                <Activity aria-hidden />
                {r.newVisit}
              </Button>
            </div>
            {q.data.visits.length === 0 ? (
              <p className="text-body text-ink-muted">{r.noVisits}</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line">
                {q.data.visits.map((v) => (
                  <li key={v.id} className="flex flex-col gap-1 py-3">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-caption text-ink-muted">{when(v.visitedAt)}</span>
                      <Pill
                        tone={v.outcome === 'sent_home' || v.outcome === 'referred' ? 'warn' : 'go'}
                      >
                        {t.outcomes[v.outcome]}
                      </Pill>
                      {v.parentTold && <Pill>{t.parentTold}</Pill>}
                    </span>
                    <span className="text-body text-ink">{v.notes.complaint}</span>
                    {v.notes.care && (
                      <span className="text-caption text-ink-muted">{v.notes.care}</span>
                    )}
                    {v.recordedBy && (
                      <span className="text-caption text-ink-muted">{r.by(v.recordedBy)}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      )}
      {visiting && (
        <VisitForm
          institutionId={institutionId}
          studentId={studentId}
          onClose={() => setVisiting(false)}
          onDone={async () => {
            setVisiting(false);
            setNote(r.visitSaved);
            for (const k of ['health-record', 'health-visits', 'health-totals'])
              await qc.invalidateQueries({ queryKey: [k] });
          }}
        />
      )}
    </RecordDrawer>
  );
}

function VisitForm({
  institutionId,
  studentId,
  onClose,
  onDone,
}: {
  institutionId: string;
  studentId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const r = t.record;
  const [complaint, setComplaint] = useState('');
  const [care, setCare] = useState('');
  const [outcome, setOutcome] = useState<VisitOutcome>('back_to_class');
  const [parentTold, setParentTold] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api.post(`/health/students/${studentId}/visits`, {
        institutionId,
        complaint,
        care,
        outcome,
        parentTold,
      }),
    onSuccess: onDone,
  });
  return (
    <FormModal
      title={r.newVisit}
      submitLabel={r.saveVisit}
      cancelLabel={en.health.emergency.cancel}
      pending={save.isPending}
      submitDisabled={!complaint.trim()}
      error={save.error ? errorText(save.error) : null}
      size="md"
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <ModalField label={r.complaint} wide>
        <input
          className={fieldInput}
          value={complaint}
          maxLength={1000}
          onChange={(e) => setComplaint(e.target.value)}
        />
      </ModalField>
      <ModalField label={r.care} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={3}
          maxLength={2000}
          value={care}
          onChange={(e) => setCare(e.target.value)}
        />
      </ModalField>
      <ModalField label={r.outcome}>
        <select
          className={fieldInput}
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as VisitOutcome)}
        >
          {OUTCOMES.map((o) => (
            <option key={o} value={o}>
              {t.outcomes[o]}
            </option>
          ))}
        </select>
      </ModalField>
      <label className="flex items-center gap-2 self-end pb-2.5">
        <input
          type="checkbox"
          className="size-4 accent-navy-950"
          checked={parentTold}
          onChange={(e) => setParentTold(e.target.checked)}
        />
        <span className="text-body text-ink">{r.tellParent}</span>
      </label>
    </FormModal>
  );
}

function BreakGlass({ institutionId, onClose }: { institutionId: string; onClose: () => void }) {
  const e = t.emergency;
  const [text, setText] = useState('');
  const [student, setStudent] = useState<Found | null>(null);
  const [reason, setReason] = useState('');
  const found = useStudentSearch(institutionId, student ? '' : text);
  const open = useMutation({
    mutationFn: () =>
      api.post<EmergencyView>(`/health/students/${student?.personId}/emergency`, {
        institutionId,
        reason,
      }),
  });
  if (open.data)
    return (
      <RecordDrawer
        open
        onOpenChange={(o) => !o && onClose()}
        title={open.data.name}
        subtitle={e.expires(time(open.data.expiresAt))}
        closeLabel={t.record.close}
      >
        <dl className="flex flex-col divide-y divide-line" role="alert">
          <div className="flex flex-col gap-1 py-3">
            <dt className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
              {t.record.bloodGroup}
            </dt>
            <dd className="font-display text-[1.75rem] font-semibold text-ink">
              {open.data.bloodGroup ?? t.record.unknown}
            </dd>
          </div>
          <div className="flex flex-col gap-1 py-3">
            <dt className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
              {t.record.allergies}
            </dt>
            <dd className="text-body font-medium text-signal-stop-ink">
              {open.data.allergies || '—'}
            </dd>
          </div>
          <div className="flex flex-col gap-1 py-3">
            <dt className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
              {t.record.responderNotes}
            </dt>
            <dd className="text-body text-ink">{open.data.responderNotes || '—'}</dd>
          </div>
        </dl>
      </RecordDrawer>
    );
  return (
    <FormModal
      title={e.title}
      description={e.lead}
      submitLabel={e.open}
      cancelLabel={e.cancel}
      pending={open.isPending}
      submitDisabled={!student || reason.trim().length < 10}
      error={open.error ? errorText(open.error) : null}
      size="md"
      tone="danger"
      onClose={onClose}
      onSubmit={() => open.mutate()}
    >
      <ModalField label={e.student} wide>
        {student ? (
          <span className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
            <span className="text-body text-ink">{student.name}</span>
            <Button variant="quiet" size="sm" onClick={() => setStudent(null)}>
              {e.change}
            </Button>
          </span>
        ) : (
          <input
            className={fieldInput}
            value={text}
            autoComplete="off"
            onChange={(ev) => setText(ev.target.value)}
          />
        )}
      </ModalField>
      {!student && text.trim().length >= 2 && (
        <ul className="flex flex-col sm:col-span-2" aria-label={t.find}>
          {(found.data ?? []).slice(0, 6).map((s) => (
            <li key={s.personId}>
              <button
                type="button"
                onClick={() => setStudent(s)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left hover:bg-paper"
              >
                <span className="text-body text-ink">{s.name}</span>
                <span className="text-caption text-ink-muted">{s.placement}</span>
              </button>
            </li>
          ))}
          {found.data?.length === 0 && <li className="text-body text-ink-muted">{t.noMatch}</li>}
        </ul>
      )}
      <ModalField label={e.reason} hint={e.reasonHint} wide>
        <textarea
          className={cx(fieldInput, 'h-auto py-2')}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
        />
      </ModalField>
    </FormModal>
  );
}
