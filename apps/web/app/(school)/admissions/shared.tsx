'use client';

// Shared pieces of the admissions screens: the admission year, the pipeline read, counsellors,
// stages, contact buttons, and the New lead and Send form dialogs.
import type { AdmissionYear, Pipeline, SentInvite } from '@campusverse/school-admissions';
import {
  Button,
  EmptyState,
  FormModal,
  ModalField,
  PageHeader,
  Pill,
  Segmented,
  StatePanel,
  cx,
  type Tone,
} from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  Copy,
  KanbanSquare,
  Link2,
  Mail,
  MessageCircle,
  MessageSquareText,
  Phone,
  type LucideIcon,
} from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { useInstitution } from '../attendance/shared';
import { CustomFields, useFields, type Values } from '../common/custom-fields';

export const t = en.admissions;
export const c = en.admissionsCrm;
export const admissionError = (e: unknown): string =>
  t.errors[e instanceof ApiFailure ? e.code : 'error'] ??
  c.errors[e instanceof ApiFailure ? e.code : 'error'] ??
  t.errors.error ??
  '';
export const field =
  'h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-navy-950';

export type App = Pipeline['applications'][number];

export const OPEN = [
  'enquiry',
  'contacted',
  'applied',
  'documents_pending',
  'under_review',
  'offered',
  'waitlisted',
  'confirmed',
] as const;
export const CLOSED = ['enrolled', 'lost', 'withdrawn', 'rejected'] as const;

export const STAGE_TONE: Record<string, Tone> = {
  enquiry: 'neutral',
  contacted: 'neutral',
  applied: 'neutral',
  documents_pending: 'warn',
  under_review: 'neutral',
  offered: 'go',
  waitlisted: 'warn',
  confirmed: 'go',
  enrolled: 'go',
  lost: 'neutral',
  withdrawn: 'neutral',
  rejected: 'stop',
};
export const STAGE_DOT: Record<string, string> = {
  enquiry: 'bg-sky-ink',
  contacted: 'bg-navy-950',
  applied: 'bg-violet-ink',
  documents_pending: 'bg-signal-warn',
  under_review: 'bg-amber-ink',
  offered: 'bg-teal-ink',
  waitlisted: 'bg-rose-ink',
  confirmed: 'bg-signal-go',
  enrolled: 'bg-signal-go',
  lost: 'bg-ink-faint',
  withdrawn: 'bg-ink-faint',
  rejected: 'bg-signal-stop',
};

export function StagePill({ state }: { state: string }) {
  return <Pill tone={STAGE_TONE[state] ?? 'neutral'}>{t.states[state] ?? state}</Pill>;
}

const INTEREST_DOT: Record<string, string> = {
  hot: 'bg-signal-stop',
  warm: 'bg-signal-warn',
  cold: 'bg-sky-ink',
};
export function Interest({ value }: { value: string | null }) {
  if (!value) return <span className="text-caption text-ink-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-caption font-medium text-ink">
      <span aria-hidden className={cx('size-2 rounded-full', INTEREST_DOT[value])} />
      {c.interest[value]}
    </span>
  );
}

/** The school's years admissions work in (Academic years), oldest first. */
export function useAdmissionYears() {
  const school = useInstitution();
  const id = school.institutionId;
  const q = useQuery({
    queryKey: ['admission-years', id],
    queryFn: () => api.get<AdmissionYear[]>(`/school/admissions/${id}/years`),
    enabled: !!id,
  });
  return { ...q, isPending: school.isPending || (!!id && q.isPending), school };
}

/** The year coming next if it is set up (admissions are mostly for it), else the running one. */
export const defaultYear = (ys: AdmissionYear[]) =>
  (ys.find((y) => y.status === 'planned') ?? ys.find((y) => y.status === 'active') ?? ys.at(-1))
    ?.label ?? '';

/** The admission year in the address (?year=), so every admissions page keeps it. */
export function useYear(): [string, (y: string) => void] {
  const years = useAdmissionYears().data ?? [];
  const params = useSearchParams();
  const path = usePathname();
  const asked = params.get('year');
  const fromUrl = asked && years.some((y) => y.label === asked) ? asked : defaultYear(years);
  const [year, setYear] = useState(fromUrl);
  useEffect(() => setYear(fromUrl), [fromUrl]);
  const set = useCallback(
    (y: string) => {
      setYear(y);
      const p = new URLSearchParams(params.toString());
      p.set('year', y);
      window.history.replaceState(null, '', `${path}?${p.toString()}`);
    },
    [params, path],
  );
  return [year, set];
}

export function YearPicker({ year, onChange }: { year: string; onChange: (y: string) => void }) {
  const years = useAdmissionYears().data ?? [];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Segmented
        label={t.year}
        value={year}
        onChange={onChange}
        options={years.map((y) => ({ value: y.label, label: y.label }))}
      />
      {!years.some((y) => y.status === 'planned') && (
        <Link
          href="/year-end"
          className="rounded-md text-caption font-medium text-navy-950 underline-offset-4 hover:underline"
        >
          {c.years.setUpNext}
        </Link>
      )}
    </div>
  );
}

/**
 * Admissions pages render inside this: the school's years load first, and a school with none set
 * up is sent to Academic years rather than shown guessed years.
 */
export function AdmissionYearGate({ children }: { children: ReactNode }) {
  const years = useAdmissionYears();
  if (years.isPending) return <StatePanel kind="loading" title={en.states.loading.title} />;
  if (years.isError || years.school.isError)
    return years.error instanceof ApiFailure && years.error.status === 403 ? (
      <StatePanel kind="denied" title={en.states.denied.title} body={en.states.denied.body} />
    ) : (
      <StatePanel
        kind="error"
        title={en.states.error.title}
        body={admissionError(years.error ?? years.school.error)}
        action={en.states.error.action}
        onAction={() => void years.refetch()}
      />
    );
  if ((years.data ?? []).length > 0) return children;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={KanbanSquare}
        eyebrow={en.systems.groups.enrollment}
        title={c.pipeline.title}
        description={c.pipeline.lead}
      />
      <div className="panel">
        <EmptyState
          art="admissions"
          title={c.years.noneTitle}
          body={c.years.noneBody}
          actions={
            <Link
              href="/years"
              className="inline-flex h-10 items-center rounded-lg bg-navy-950 px-4 text-body font-medium text-white hover:bg-navy-900"
            >
              {c.years.noneAction}
            </Link>
          }
        />
      </div>
    </div>
  );
}

export function usePipeline(institutionId: string | undefined, year: string) {
  return useQuery({
    queryKey: ['admissions', institutionId, year],
    queryFn: () => api.get<Pipeline>(`/school/admissions/${institutionId}?year=${year}`),
    enabled: !!institutionId && !!year,
  });
}

export function useCounsellors(institutionId: string | undefined) {
  return useQuery({
    queryKey: ['admission-counsellors', institutionId],
    queryFn: () =>
      api.get<{ personId: string; name: string }[]>(
        `/school/admissions/${institutionId}/counsellors`,
      ),
    enabled: !!institutionId,
    staleTime: 300_000,
  });
}

const DAY = 864e5;
export const todayIso = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const plusDays = (n: number) =>
  new Date(Date.now() + 330 * 60_000 + n * DAY).toISOString().slice(0, 10);
/** Days from today to a date (negative: past). */
export const daysTo = (iso: string) =>
  Math.round(
    (Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayIso()}T00:00:00Z`)) / DAY,
  );
const dayFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
export const shortDate = (iso: string) => dayFmt.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
const atFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'Asia/Kolkata',
});
export const when = (ts: string) => atFmt.format(new Date(ts));
/** "Today", "Tomorrow", "In 3 days", "2 days ago", or a date beyond a week. */
export function relDay(iso: string): string {
  const d = daysTo(iso);
  if (d === 0) return c.rel.today;
  if (d === 1) return c.rel.tomorrow;
  if (d === -1) return c.rel.yesterday;
  if (d > 1 && d <= 7) return c.rel.inDays(d);
  if (d < -1 && d >= -7) return c.rel.daysAgo(-d);
  return shortDate(iso);
}

const wa = (phone: string, text?: string) =>
  `https://wa.me/${phone.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
const sms = (phone: string, text: string) => `sms:${phone}?&body=${encodeURIComponent(text)}`;
const mail = (to: string, subject: string, body: string) =>
  `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Call, WhatsApp and email buttons for a family. */
export function ContactActions({
  phone,
  email,
  name,
  size = 'md',
}: {
  phone: string | null;
  email?: string | null;
  name: string;
  size?: 'sm' | 'md';
}) {
  const box = cx(
    'inline-flex items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:border-line-strong hover:text-navy-950',
    size === 'sm' ? 'size-8' : 'size-9',
  );
  return (
    <span className="flex items-center gap-1.5">
      {phone && (
        <a href={`tel:${phone}`} aria-label={c.contact.call(name)} className={box}>
          <Phone aria-hidden className="size-4" />
        </a>
      )}
      {phone && (
        <a
          href={wa(phone)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={c.contact.whatsapp(name)}
          className={box}
        >
          <MessageCircle aria-hidden className="size-4" />
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} aria-label={c.contact.email(name)} className={box}>
          <Mail aria-hidden className="size-4" />
        </a>
      )}
    </span>
  );
}

type Channel = 'whatsapp' | 'sms' | 'email' | 'link';
const CHANNELS: { value: Channel; Icon: LucideIcon }[] = [
  { value: 'whatsapp', Icon: MessageCircle },
  { value: 'sms', Icon: MessageSquareText },
  { value: 'email', Icon: Mail },
  { value: 'link', Icon: Link2 },
];

export type Lead = {
  id: string;
  childName: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
};

/**
 * Send the application form: a personal link for a lead (its answers start filled in) or for a
 * new family. The office's own WhatsApp, messages or email app sends it, with the message ready.
 */
export function SendFormDialog({
  institutionId,
  year,
  lead,
  onClose,
}: {
  institutionId: string;
  year: string;
  lead?: Lead | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [channel, setChannel] = useState<Channel>('whatsapp');
  const [childName, setChildName] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [address, setAddress] = useState('');
  const defaultAddress =
    channel === 'email'
      ? (lead?.guardianEmail ?? '')
      : channel === 'link'
        ? ''
        : (lead?.guardianPhone.slice(3) ?? '');
  const to = address || defaultAddress;
  const send = useMutation({
    mutationFn: () =>
      api.post<SentInvite>(`/school/admissions/${institutionId}/invites`, {
        yearLabel: year,
        applicationId: lead?.id ?? null,
        channel,
        address:
          channel === 'link'
            ? null
            : channel === 'email'
              ? to.trim()
              : `+91${to.replace(/\D/g, '').slice(-10)}`,
        childName: lead ? null : childName || null,
        guardianName: lead ? null : guardianName || null,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admissions'] });
      void qc.invalidateQueries({ queryKey: ['application'] });
      void qc.invalidateQueries({ queryKey: ['admission-invites'] });
    },
  });
  if (send.data) return <SentDialog sent={send.data} onClose={onClose} />;

  const phoneOk = /^[6-9]\d{9}$/.test(to.replace(/\D/g, '').slice(-10));
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim());
  const ready =
    (channel === 'link' || (channel === 'email' ? emailOk : phoneOk)) &&
    (!!lead ||
      (childName.trim().length > 1 && guardianName.trim().length > 1) ||
      channel === 'link');
  return (
    <FormModal
      title={lead ? c.send.titleFor(lead.childName) : c.send.title}
      description={c.send.lead(year)}
      submitLabel={c.send.create}
      cancelLabel={en.form.cancel}
      size="lg"
      pending={send.isPending}
      submitDisabled={!ready}
      error={send.error ? admissionError(send.error) : null}
      onClose={onClose}
      onSubmit={() => send.mutate()}
    >
      <fieldset className="col-span-full flex flex-col gap-2">
        <legend className="mb-1.5 text-caption font-medium text-ink">{c.send.how}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {CHANNELS.map(({ value, Icon }) => {
            const on = channel === value;
            return (
              <label
                key={value}
                className={cx(
                  'flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-body font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy-950',
                  on
                    ? 'border-navy-950 bg-navy-50 text-navy-950'
                    : 'border-line text-ink hover:border-line-strong',
                )}
              >
                <input
                  type="radio"
                  name="send-channel"
                  value={value}
                  checked={on}
                  onChange={() => {
                    setChannel(value);
                    setAddress('');
                  }}
                  className="sr-only"
                />
                <Icon
                  aria-hidden
                  className={cx('size-5', on ? 'text-navy-950' : 'text-ink-muted')}
                />
                {c.send.channels[value]}
              </label>
            );
          })}
        </div>
      </fieldset>
      {!lead && (
        <>
          <ModalField label={c.send.childName} hint={c.send.optionalForLink}>
            <input
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              className={field}
            />
          </ModalField>
          <ModalField label={c.send.guardianName} hint={c.send.optionalForLink}>
            <input
              value={guardianName}
              onChange={(e) => setGuardianName(e.target.value)}
              className={field}
            />
          </ModalField>
        </>
      )}
      {channel !== 'link' && (
        <ModalField label={channel === 'email' ? c.send.email : c.send.mobile} wide>
          {channel === 'email' ? (
            <input
              type="email"
              value={to}
              onChange={(e) => setAddress(e.target.value)}
              className={field}
            />
          ) : (
            <span className="relative flex items-center">
              <span
                aria-hidden
                className="tabular pointer-events-none absolute left-3 text-ink-muted"
              >
                +91
              </span>
              <input
                inputMode="tel"
                value={to}
                onChange={(e) => setAddress(e.target.value)}
                className={cx(field, 'tabular pl-12')}
              />
            </span>
          )}
        </ModalField>
      )}
      <p className="col-span-full flex items-start gap-2 rounded-lg bg-navy-50/60 px-3 py-2.5 text-caption text-ink">
        <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-navy-950" />
        {lead ? c.send.prefilled : c.send.newFamily}
      </p>
    </FormModal>
  );
}

/** A personal link made: the message ready to send from the office's own apps, or to copy. */
export function SentDialog({
  sent: s,
  title = c.send.readyTitle,
  onClose,
}: {
  sent: SentInvite;
  title?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<'message' | 'link' | null>(null);
  const copy = (what: 'message' | 'link', text: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(what),
      () => undefined,
    );
  const open =
    s.channel === 'whatsapp' && s.address
      ? { href: wa(s.address, s.text), label: c.send.openWhatsapp }
      : s.channel === 'sms' && s.address
        ? { href: sms(s.address, s.text), label: c.send.openSms }
        : s.channel === 'email' && s.address
          ? { href: mail(s.address, c.send.subject, s.text), label: c.send.openEmail }
          : null;
  return (
    <FormModal
      title={title}
      description={c.send.readyLead}
      submitLabel={c.send.done}
      cancelLabel={c.send.close}
      size="lg"
      onClose={onClose}
      onSubmit={onClose}
    >
      <div className="col-span-full flex flex-col gap-4">
        <div className="rounded-xl border border-line bg-paper p-4">
          <p className="text-caption font-medium text-ink-muted">
            {s.address ? c.send.to(s.address) : c.send.anyone}
          </p>
          <p className="mt-1.5 text-body whitespace-pre-wrap text-ink">{s.text}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && (
            <a
              href={open.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-navy-950 px-4 text-body font-medium text-white shadow-[var(--shadow-button)] hover:bg-navy-950/90"
            >
              {open.label}
            </a>
          )}
          <Button variant="secondary" onClick={() => copy('message', s.text)}>
            <Copy aria-hidden className="size-4" />
            {copied === 'message' ? c.send.copied : c.send.copyMessage}
          </Button>
          <Button variant="secondary" onClick={() => copy('link', s.link)}>
            <Link2 aria-hidden className="size-4" />
            {copied === 'link' ? c.send.copied : c.send.copyLink}
          </Button>
        </div>
        <p className="text-caption text-ink-muted" aria-live="polite">
          {c.send.tracking}
        </p>
      </div>
    </FormModal>
  );
}

/** A new lead from a call, a walk-in or a referral, with who owns it and when to follow up. */
export function NewLeadDialog({
  institutionId,
  year,
  classes: all,
  onClose,
  onDone,
}: {
  institutionId: string;
  year: string;
  classes: Pipeline['classes'];
  onClose: () => void;
  onDone: (r: { id: string; message: string; sendForm: Lead | null }) => void;
}) {
  // Only classes the year runs (they have sections in it) take new families.
  const classes = all.filter((k) => k.running);
  const qc = useQueryClient();
  const counsellors = useCounsellors(institutionId);
  const [f, setF] = useState({
    classId: classes[0]?.classId ?? '',
    category: 'general',
    source: 'walk_in',
    childName: '',
    dateOfBirth: '',
    gender: '',
    guardianName: '',
    guardianPhone: '',
    guardianEmail: '',
    guardianRelationship: 'mother',
    campaign: '',
    ownerPersonId: '',
    interest: '',
    nextFollowUp: plusDays(1),
    notes: '',
  });
  const [sendForm, setSendForm] = useState(true);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }));
  const fields = useFields('admission');
  const [custom, setCustom] = useState<Values>({});
  const save = useMutation({
    mutationFn: () =>
      api.post<{ id: string; siblings: { studentName: string }[] }>(
        `/school/admissions/${institutionId}/enquiries`,
        {
          yearLabel: year,
          classId: f.classId,
          category: f.category,
          source: f.source,
          childName: f.childName,
          dateOfBirth: f.dateOfBirth || null,
          gender: f.gender || null,
          guardianName: f.guardianName,
          guardianPhone: `+91${f.guardianPhone.replace(/\D/g, '').slice(-10)}`,
          guardianRelationship: f.guardianRelationship,
          nextFollowUp: f.nextFollowUp || null,
          notes: f.notes || null,
          campaign: f.campaign || null,
          ownerPersonId: f.ownerPersonId || null,
          interest: f.interest || null,
          details: { guardianEmail: f.guardianEmail || null },
          ...(Object.keys(custom).length ? { custom } : {}),
        },
      ),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['admissions'] });
      onDone({
        id: r.id,
        message: r.siblings.length
          ? t.siblingFound(r.siblings.map((s) => s.studentName).join(', '))
          : c.lead.saved,
        sendForm: sendForm
          ? {
              id: r.id,
              childName: f.childName,
              guardianName: f.guardianName,
              guardianPhone: `+91${f.guardianPhone.replace(/\D/g, '').slice(-10)}`,
              guardianEmail: f.guardianEmail || null,
            }
          : null,
      });
    },
  });
  const heading = (text: string) => (
    <p className="col-span-full -mb-1 pt-1 text-caption font-semibold tracking-[0.12em] text-ink-muted uppercase">
      {text}
    </p>
  );
  return (
    <FormModal
      title={c.lead.title}
      description={c.lead.lead(year)}
      size="xl"
      submitLabel={c.lead.save}
      cancelLabel={en.form.cancel}
      pending={save.isPending}
      error={save.isError ? admissionError(save.error) : null}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      {heading(c.lead.child)}
      <ModalField label={t.childName}>
        <input required value={f.childName} onChange={set('childName')} className={field} />
      </ModalField>
      <ModalField
        label={t.className}
        hint={
          classes.length === 0 ? (
            <Link href="/classes" className="text-navy-950 underline underline-offset-4">
              {c.years.noClasses(year)}
            </Link>
          ) : undefined
        }
      >
        <select value={f.classId} onChange={set('classId')} className={field}>
          {classes.map((k) => (
            <option key={k.classId} value={k.classId}>
              {k.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.dateOfBirth} hint={c.optional}>
        <input type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} className={field} />
      </ModalField>
      <ModalField label={c.gender} hint={c.optional}>
        <select value={f.gender} onChange={set('gender')} className={field}>
          <option value="">—</option>
          {Object.entries(c.genders).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </ModalField>
      {heading(c.lead.family)}
      <ModalField label={t.guardianName}>
        <input required value={f.guardianName} onChange={set('guardianName')} className={field} />
      </ModalField>
      <ModalField label={t.relationship}>
        <select
          value={f.guardianRelationship}
          onChange={set('guardianRelationship')}
          className={field}
        >
          {Object.entries(t.relationships).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.guardianPhone}>
        <input
          required
          inputMode="tel"
          value={f.guardianPhone}
          onChange={set('guardianPhone')}
          className={field}
        />
      </ModalField>
      <ModalField label={c.email} hint={c.optional}>
        <input
          type="email"
          value={f.guardianEmail}
          onChange={set('guardianEmail')}
          className={field}
        />
      </ModalField>
      {heading(c.lead.work)}
      <ModalField label={t.source}>
        <select value={f.source} onChange={set('source')} className={field}>
          {Object.entries(t.sources).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={c.campaign} hint={c.campaignHint}>
        <input value={f.campaign} maxLength={60} onChange={set('campaign')} className={field} />
      </ModalField>
      <ModalField label={c.owner}>
        <select value={f.ownerPersonId} onChange={set('ownerPersonId')} className={field}>
          <option value="">{c.unassigned}</option>
          {(counsellors.data ?? []).map((p) => (
            <option key={p.personId} value={p.personId}>
              {p.name}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={c.interestLabel}>
        <select value={f.interest} onChange={set('interest')} className={field}>
          <option value="">—</option>
          {Object.entries(c.interest).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.category}>
        <select value={f.category} onChange={set('category')} className={field}>
          {Object.entries(t.categories).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </ModalField>
      <ModalField label={t.nextFollowUp}>
        <input
          type="date"
          value={f.nextFollowUp}
          onChange={set('nextFollowUp')}
          className={field}
        />
      </ModalField>
      <ModalField label={c.notes} hint={c.optional} wide>
        <textarea
          rows={2}
          maxLength={2000}
          value={f.notes}
          onChange={set('notes')}
          className={cx(field, 'h-auto py-2')}
        />
      </ModalField>
      {fields.data && fields.data.length > 0 && (
        <div className="col-span-full flex flex-col gap-4 border-t border-line pt-5">
          <p className="text-body font-semibold text-ink">{en.customFields.title}</p>
          <CustomFields
            fields={fields.data}
            values={custom}
            onChange={(k, v) => setCustom((x) => ({ ...x, [k]: v }))}
            problems={
              save.error instanceof ApiFailure && save.error.code === 'values'
                ? ((save.error.details as { problems?: Record<string, string> } | null)?.problems ??
                  {})
                : {}
            }
            idPrefix="enquiry"
          />
        </div>
      )}
      <label className="col-span-full flex items-center gap-2.5 rounded-lg border border-line px-3 py-2.5 text-body text-ink">
        <input
          type="checkbox"
          checked={sendForm}
          onChange={(e) => setSendForm(e.target.checked)}
          className="size-4 accent-[#04266d]"
        />
        {c.lead.sendAfter}
      </label>
    </FormModal>
  );
}
