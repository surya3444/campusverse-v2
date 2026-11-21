'use client';

// The family's side of the online form (docs/specs/ONLINE_APPLICATIONS.md, owner's brief of
// 20 Nov 2026): prove the mobile first, then the child, the family, home and background, the
// papers, and a review before submitting. A personal link from the school starts filled in; a
// papers link goes straight to the papers asked for. Answers are kept on this device until sent,
// so a family can come back. "Check an application" shows where things stand and takes papers.
import type { Field } from '@campusverse/platform-fields';
import type { FamilyStatus, Prefill, PublicForm } from '@campusverse/school-admissions';
import { STATES } from '@campusverse/rules';
import { Button, cx } from '@campusverse/ui';
import {
  Check,
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  FileUp,
  Lock,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { CustomFields, fieldInput, type Values } from '../../(school)/common/custom-fields';

const t = en.apply;
type Simulated = { simulated?: { text: string } };
type Needed = { kind: string; title: string; note: string | null };
type Status = {
  reference: string | null;
  firstName: string;
  className: string;
  status: FamilyStatus;
  offerUntil: string | null;
  papersNeeded: Needed[];
  session: string | null;
};
type Started = {
  session: string;
  purpose: 'apply' | 'papers';
  prefill: Prefill | null;
  papersNeeded: Needed[];
};
type Uploaded = { kind: string; ticket: string; fileName: string };

const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const dmyy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));
const errorOf = (e: unknown) =>
  (e instanceof ApiFailure ? t.errors[e.code] : undefined) ?? t.errors.error ?? '';

function Label({
  id,
  label,
  hint,
  optional,
  children,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-ink">
        {label}
        {optional && <span className="font-normal text-ink-muted"> · {t.optional}</span>}
      </label>
      {children}
      {hint && (
        <span id={`${id}-hint`} className="text-caption text-ink-muted">
          {hint}
        </span>
      )}
    </div>
  );
}

/** Mobile number with Send code; shows the simulated SMS while testing. */
function PhoneCode({
  slug,
  idPrefix,
  phone,
  setPhone,
  code,
  setCode,
  hint,
}: {
  slug: string;
  idPrefix: string;
  phone: string;
  setPhone: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  hint?: string | undefined;
}) {
  const [sent, setSent] = useState(false);
  const [sms, setSms] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Simulated>(`/public/apply/${slug}/code`, { phone });
      setSent(true);
      setSms(r?.simulated?.text ?? null);
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Label id={`${idPrefix}-phone`} label={t.phone} hint={hint ?? t.phoneHint}>
        <span className="flex gap-2">
          <input
            id={`${idPrefix}-phone`}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            aria-describedby={`${idPrefix}-phone-hint`}
            className={fieldInput}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={busy || phone.replace(/\D/g, '').length < 10}
            onClick={() => void send()}
          >
            {sent ? t.resend : t.sendCode}
          </Button>
        </span>
      </Label>
      <Label id={`${idPrefix}-code`} label={t.code}>
        <input
          id={`${idPrefix}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className={cx(fieldInput, 'tabular tracking-[0.3em]')}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </Label>
      <div aria-live="polite" className="flex flex-col gap-1 text-caption sm:col-span-2">
        {sent && <span className="text-ink-muted">{t.codeSent}</span>}
        {sms && (
          <span className="rounded-lg bg-navy-50 px-3 py-2 text-navy-950">{t.simulated(sms)}</span>
        )}
        {error && (
          <span role="alert" className="text-signal-stop-ink">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/** One paper: choose a file, it uploads at once; shows the file and lets the family replace it. */
function PaperUpload({
  slug,
  session,
  kind,
  title,
  required,
  note,
  value,
  onChange,
}: {
  slug: string;
  session: string;
  kind: string;
  title: string;
  required: boolean;
  note?: string | null | undefined;
  value: Uploaded | undefined;
  onChange: (u: Uploaded | undefined) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return setError(t.errors.file_size ?? '');
    setBusy(true);
    setError(null);
    try {
      const r = await api.upload<{ ticket: string; kind: string; fileName: string }>(
        `/public/apply/${slug}/papers`,
        file,
        { session, kind },
      );
      onChange({ kind, ticket: r.ticket, fileName: r.fileName });
    } catch (e) {
      setError(errorOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li
      className={cx(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        value ? 'border-signal-go/40 bg-signal-go-tint/40' : 'border-line',
      )}
    >
      <span
        className={cx(
          'flex size-9 shrink-0 items-center justify-center rounded-lg',
          value ? 'bg-signal-go text-white' : 'bg-navy-50 text-navy-950',
        )}
      >
        {value ? (
          <Check aria-hidden className="size-4" />
        ) : (
          <FileUp aria-hidden className="size-4" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-ink">
          {title}
          {!required && <span className="font-normal text-ink-muted"> · {t.optional}</span>}
        </span>
        <span className="truncate text-caption text-ink-muted">
          {busy ? t.uploading : value ? value.fileName : t.paperHint}
        </span>
        {note && (
          <span className="text-caption font-medium text-signal-stop-ink">
            {t.schoolSaid(note)}
          </span>
        )}
        {error && (
          <span role="alert" className="text-caption text-signal-stop-ink">
            {error}
          </span>
        )}
      </span>
      <Button
        type="button"
        size="sm"
        variant={value ? 'quiet' : 'secondary'}
        disabled={busy}
        onClick={() => input.current?.click()}
        aria-label={value ? t.replaceFor(title) : t.uploadFor(title)}
      >
        {value ? t.replace : t.upload}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        capture={kind === 'photo' ? 'user' : undefined}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </li>
  );
}

function readDraft(key: string): { f: Answers; custom: Values } | null {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null') as {
      f: Answers;
      custom: Values;
    } | null;
  } catch {
    return null;
  }
}

const STEP_KEYS = ['mobile', 'child', 'family', 'home', 'papers', 'review'] as const;
type Step = (typeof STEP_KEYS)[number];

const blank = {
  childName: '',
  dateOfBirth: '',
  gender: '',
  classId: '',
  guardianName: '',
  guardianRelationship: 'mother',
  details: {} as Record<string, string>,
};
type Answers = typeof blank;

export function ApplyForm({
  slug,
  form,
  invite,
}: {
  slug: string;
  form: PublicForm;
  invite: string | null;
}) {
  const draftKey = `cv.apply.${slug}${invite ? '.invite' : ''}`;
  const papersOnly = form.invite?.purpose === 'papers';
  const steps: Step[] = papersOnly ? ['mobile', 'papers'] : [...STEP_KEYS];
  const [step, setStep] = useState<Step>('mobile');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [started, setStarted] = useState<Started | null>(null);
  const [f, setF] = useState<Answers>({ ...blank, classId: form.classes[0]?.classId ?? '' });
  const [custom, setCustom] = useState<Values>({});
  const [papers, setPapers] = useState<Record<string, Uploaded>>({});
  const [consent, setConsent] = useState(false);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    kind: 'received' | 'duplicate' | 'papers';
    reference: string | null;
  } | null>(null);
  const [resumed, setResumed] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  // Answers stay on this device until sent (not the code, the session or the papers).
  useEffect(() => {
    if (!started || papersOnly) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify({ f, custom }));
    } catch {
      // private mode: nothing kept
    }
  }, [f, custom, started, draftKey, papersOnly]);

  const has = (s: string) => (form.sections as string[]).includes(s);
  const cls = form.classes.find((c) => c.classId === f.classId);
  const questions: Field[] = form.questions.map((q, i) => ({
    ...q,
    id: q.key,
    entity: 'admission',
    position: i,
    retired: false,
  }));
  const set = (k: keyof Omit<Answers, 'details'>) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));
  const setD = (k: string) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, details: { ...cur.details, [k]: e.target.value } }));
  const go = (s: Step) => {
    setError(null);
    setStep(s);
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    top.current?.focus();
  };
  const index = steps.indexOf(step);
  const next = () => {
    const n = steps[index + 1];
    if (n) go(n);
  };
  const back = () => {
    const p = steps[index - 1];
    if (p && p !== 'mobile') go(p);
  };

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Started>(`/public/apply/${slug}/start`, { phone, code, invite });
      setStarted(r);
      setCode('');
      const saved = readDraft(draftKey);
      if (saved && !r.prefill) {
        setF({ ...blank, ...saved.f, details: { ...saved.f.details } });
        setCustom(saved.custom ?? {});
        setResumed(true);
      } else if (r.prefill) {
        const p = r.prefill;
        setF({
          childName: p.childName,
          dateOfBirth: p.dateOfBirth ?? '',
          gender: p.gender ?? '',
          classId:
            p.classId && form.classes.some((c) => c.classId === p.classId)
              ? p.classId
              : (form.classes[0]?.classId ?? ''),
          guardianName: p.guardianName,
          guardianRelationship: p.guardianRelationship,
          details: Object.fromEntries(Object.entries(p.details).map(([k, v]) => [k, v ?? ''])),
        });
      }
      go(r.purpose === 'papers' ? 'papers' : 'child');
    } catch (err) {
      setError(
        err instanceof ApiFailure &&
          err.code === 'phone_not_on_application' &&
          form.invite?.phoneEnds
          ? t.useNumber(form.invite.phoneEnds)
          : errorOf(err),
      );
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!started) return;
    setBusy(true);
    setError(null);
    setProblems({});
    try {
      if (started.purpose === 'papers') {
        await api.post(`/public/apply/${slug}/send-papers`, {
          session: started.session,
          papers: Object.values(papers).map(({ kind, ticket }) => ({ kind, ticket })),
        });
        setDone({ kind: 'papers', reference: null });
      } else {
        const r = await api.post<{ status: 'received' | 'duplicate'; reference: string | null }>(
          `/public/apply/${slug}`,
          {
            session: started.session,
            childName: f.childName,
            dateOfBirth: f.dateOfBirth,
            gender: f.gender,
            classId: f.classId,
            guardianName: f.guardianName,
            guardianRelationship: f.guardianRelationship,
            details: Object.fromEntries(
              Object.entries(f.details).map(([k, v]) => [
                k,
                k === 'secondGuardianPhone' && v
                  ? `+91${v.replace(/\D/g, '').slice(-10)}`
                  : v || null,
              ]),
            ),
            custom,
            papers: Object.values(papers).map(({ kind, ticket }) => ({ kind, ticket })),
            consent: true,
          },
        );
        setDone({ kind: r.status, reference: r.reference });
        try {
          window.localStorage.removeItem(draftKey);
        } catch {
          // nothing kept
        }
      }
      top.current?.scrollIntoView({ behavior: 'smooth' });
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'values') {
        setProblems((err.details as { problems?: Record<string, string> } | null)?.problems ?? {});
        go('home');
      }
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const childOk = f.childName.trim().length > 1 && !!f.dateOfBirth && !!f.gender && !!f.classId;
  const familyOk =
    f.guardianName.trim().length > 1 &&
    (!f.details.secondGuardianName || !!f.details.secondGuardianRelationship);
  const asked = papersOnly
    ? (started?.papersNeeded ?? []).map((n) => ({ ...n, required: true }))
    : form.papers.map((p) => ({ ...p, note: null }));
  const missingRequired = asked.filter((p) => p.required && !papers[p.kind]);
  const stateName = (code: string) => (STATES as Record<string, string>)[code] ?? code;

  return (
    <>
      <header ref={top} tabIndex={-1} className="flex flex-col gap-3 outline-none">
        <span className="inline-flex items-center gap-2 self-start rounded-full bg-navy-50 px-3 py-1 text-caption font-semibold text-navy-950">
          {t.year(form.yearLabel)}
        </span>
        <h1 className="font-display text-title font-semibold text-ink">{form.title}</h1>
        {form.invite?.usable && form.invite.purpose === 'apply' && (
          <p className="text-body text-ink">
            {t.invited(form.invite.guardianName, form.invite.childName)}
          </p>
        )}
        {form.invite?.usable && papersOnly && (
          <p className="text-body text-ink">{t.papersInvite(form.invite.childName)}</p>
        )}
        {form.intro && !papersOnly && (
          <p className="text-body whitespace-pre-line text-ink-muted">{form.intro}</p>
        )}
      </header>

      {form.invite && !form.invite.usable ? (
        <section role="status" className="panel flex items-start gap-3 p-5">
          <CircleAlert aria-hidden className="size-5 shrink-0 text-signal-warn" />
          <span className="flex flex-col gap-1">
            <span className="text-body font-semibold text-ink">{t.linkUsed}</span>
            <span className="text-body text-ink-muted">{t.linkUsedBody}</span>
          </span>
        </section>
      ) : done ? (
        <section
          role="status"
          className="panel flex flex-col items-center gap-4 px-6 py-10 text-center"
        >
          <span className="flex size-14 items-center justify-center rounded-full bg-signal-go-tint">
            <CheckCircle2 aria-hidden className="size-8 text-signal-go" />
          </span>
          <span className="font-display text-lead font-semibold text-ink">
            {done.kind === 'received'
              ? t.received
              : done.kind === 'papers'
                ? t.papersSent
                : t.duplicate}
          </span>
          <span className="max-w-md text-body text-ink">
            {done.kind === 'received'
              ? t.receivedBody(done.reference ?? '')
              : done.kind === 'papers'
                ? t.papersSentBody
                : t.duplicateBody(done.reference ?? '')}
          </span>
          {done.kind === 'received' && done.reference && (
            <span className="tabular rounded-xl border-2 border-dashed border-navy-950/30 px-6 py-3 font-display text-[1.75rem] font-bold tracking-[0.2em] text-navy-950">
              {done.reference}
            </span>
          )}
          {done.kind === 'received' && (
            <ul className="mt-2 flex flex-col gap-2 text-left text-body text-ink-muted">
              {t.whatNext.map((w) => (
                <li key={w} className="flex items-start gap-2">
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-signal-go" />
                  {w}
                </li>
              ))}
            </ul>
          )}
          {!invite && done.kind !== 'papers' && (
            <Button
              variant="secondary"
              onClick={() => {
                setDone(null);
                setF({ ...blank, classId: form.classes[0]?.classId ?? '' });
                setCustom({});
                setPapers({});
                setConsent(false);
                go('child');
              }}
            >
              {t.another}
            </Button>
          )}
        </section>
      ) : !form.accepting && !papersOnly ? (
        <section role="status" className="panel flex items-start gap-3 p-5">
          <CircleAlert aria-hidden className="size-5 shrink-0 text-signal-warn" />
          <span className="flex flex-col gap-1">
            <span className="text-body font-semibold text-ink">{t.closed}</span>
            <span className="text-body text-ink-muted">{t.closedBody}</span>
          </span>
        </section>
      ) : (
        <div className="panel flex flex-col overflow-hidden">
          <nav aria-label={t.progress} className="border-b border-line px-5 py-4">
            <p className="mb-2 text-caption font-medium text-ink-muted">
              {t.stepOf(index + 1, steps.length, t.steps[step] ?? step)}
            </p>
            <ol className="flex gap-1.5">
              {steps.map((s, i) => (
                <li key={s} className="flex-1" aria-current={s === step ? 'step' : undefined}>
                  <span
                    className={cx(
                      'block h-1.5 rounded-full',
                      i < index ? 'bg-signal-go' : i === index ? 'bg-navy-950' : 'bg-navy-50',
                    )}
                  />
                  <span className="sr-only">{t.steps[s]}</span>
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex flex-col gap-6 p-5">
            {step === 'mobile' && (
              <form onSubmit={(e) => void start(e)} className="flex flex-col gap-5" noValidate>
                <div className="flex items-start gap-3 rounded-xl bg-navy-50/60 p-4">
                  <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-navy-950" />
                  <p className="text-body text-ink">{papersOnly ? t.verifyPapers : t.verifyLead}</p>
                </div>
                <PhoneCode
                  slug={slug}
                  idPrefix="a"
                  phone={phone}
                  setPhone={setPhone}
                  code={code}
                  setCode={setCode}
                  hint={form.invite?.phoneEnds ? t.useNumber(form.invite.phoneEnds) : undefined}
                />
                <Button type="submit" disabled={busy || code.length !== 6} className="self-start">
                  {t.verifyAction}
                </Button>
              </form>
            )}

            {step === 'child' && (
              <fieldset className="flex flex-col gap-4">
                <legend className="mb-1 font-display text-lead font-semibold text-ink">
                  {t.child}
                </legend>
                {resumed && (
                  <p className="flex items-center gap-2 rounded-lg bg-navy-50/60 px-3 py-2 text-caption text-ink">
                    <RotateCcw aria-hidden className="size-3.5" />
                    {t.resumed}
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <Label id="a-child" label={t.childName}>
                    <input
                      id="a-child"
                      autoComplete="off"
                      className={fieldInput}
                      value={f.childName}
                      onChange={set('childName')}
                      maxLength={120}
                    />
                  </Label>
                  <Label id="a-dob" label={t.dateOfBirth}>
                    <input
                      id="a-dob"
                      type="date"
                      className={fieldInput}
                      value={f.dateOfBirth}
                      onChange={set('dateOfBirth')}
                    />
                  </Label>
                  <Label id="a-gender" label={t.gender}>
                    <select
                      id="a-gender"
                      className={fieldInput}
                      value={f.gender}
                      onChange={set('gender')}
                    >
                      <option value="" />
                      {Object.entries(t.genders).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Label>
                  <Label
                    id="a-class"
                    label={t.classLabel}
                    hint={
                      cls?.age
                        ? t.ageHint(
                            cls.age.minYears,
                            dmy(`${form.yearLabel.slice(0, 4)}-${cls.age.cutOff}`),
                          )
                        : undefined
                    }
                  >
                    <select
                      id="a-class"
                      className={fieldInput}
                      value={f.classId}
                      onChange={set('classId')}
                      {...(cls?.age ? { 'aria-describedby': 'a-class-hint' } : {})}
                    >
                      {form.classes.map((c) => (
                        <option key={c.classId} value={c.classId}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Label>
                  {has('background') && (
                    <Label id="a-pob" label={t.placeOfBirth} optional>
                      <input
                        id="a-pob"
                        className={fieldInput}
                        maxLength={80}
                        value={f.details.placeOfBirth ?? ''}
                        onChange={setD('placeOfBirth')}
                      />
                    </Label>
                  )}
                </div>
              </fieldset>
            )}

            {step === 'family' && (
              <>
                <fieldset className="flex flex-col gap-4">
                  <legend className="mb-1 font-display text-lead font-semibold text-ink">
                    {t.parent}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Label id="a-parent" label={t.parentName}>
                      <input
                        id="a-parent"
                        autoComplete="name"
                        className={fieldInput}
                        value={f.guardianName}
                        onChange={set('guardianName')}
                        maxLength={120}
                      />
                    </Label>
                    <Label id="a-rel" label={t.relationship}>
                      <select
                        id="a-rel"
                        className={fieldInput}
                        value={f.guardianRelationship}
                        onChange={set('guardianRelationship')}
                      >
                        {Object.entries(t.relationships).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </Label>
                    <Label id="a-verified" label={t.phone}>
                      <span
                        id="a-verified"
                        className="flex h-10 items-center gap-2 rounded-lg border border-line bg-paper px-3 text-body text-ink"
                      >
                        <Lock aria-hidden className="size-4 text-signal-go" />
                        <span className="tabular">{phone.replace(/\D/g, '').slice(-10)}</span>
                        <span className="text-caption text-signal-go-ink">{t.verified}</span>
                      </span>
                    </Label>
                    <Label id="a-email" label={t.email} optional>
                      <input
                        id="a-email"
                        type="email"
                        autoComplete="email"
                        className={fieldInput}
                        value={f.details.guardianEmail ?? ''}
                        onChange={setD('guardianEmail')}
                      />
                    </Label>
                  </div>
                </fieldset>
                {has('second_guardian') && (
                  <fieldset className="flex flex-col gap-4 border-t border-line pt-5">
                    <legend className="mb-1 font-display text-body font-semibold text-ink">
                      {t.secondParent}{' '}
                      <span className="font-normal text-ink-muted">· {t.optional}</span>
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Label id="a-p2" label={t.name}>
                        <input
                          id="a-p2"
                          className={fieldInput}
                          maxLength={120}
                          value={f.details.secondGuardianName ?? ''}
                          onChange={setD('secondGuardianName')}
                        />
                      </Label>
                      <Label id="a-p2rel" label={t.theirRelationship}>
                        <select
                          id="a-p2rel"
                          className={fieldInput}
                          value={f.details.secondGuardianRelationship ?? ''}
                          onChange={setD('secondGuardianRelationship')}
                        >
                          <option value="" />
                          {Object.entries(t.relationships).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Label>
                      <Label id="a-p2phone" label={t.phone}>
                        <input
                          id="a-p2phone"
                          type="tel"
                          inputMode="tel"
                          className={fieldInput}
                          value={(f.details.secondGuardianPhone ?? '').replace(/^\+91/, '')}
                          onChange={setD('secondGuardianPhone')}
                        />
                      </Label>
                      <Label id="a-p2email" label={t.email}>
                        <input
                          id="a-p2email"
                          type="email"
                          className={fieldInput}
                          value={f.details.secondGuardianEmail ?? ''}
                          onChange={setD('secondGuardianEmail')}
                        />
                      </Label>
                    </div>
                  </fieldset>
                )}
              </>
            )}

            {step === 'home' && (
              <>
                {has('address') && (
                  <fieldset className="flex flex-col gap-4">
                    <legend className="mb-1 font-display text-lead font-semibold text-ink">
                      {t.home}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label id="a-addr" label={t.address}>
                          <input
                            id="a-addr"
                            autoComplete="street-address"
                            className={fieldInput}
                            maxLength={300}
                            value={f.details.addressLine ?? ''}
                            onChange={setD('addressLine')}
                          />
                        </Label>
                      </div>
                      <Label id="a-city" label={t.city}>
                        <input
                          id="a-city"
                          autoComplete="address-level2"
                          className={fieldInput}
                          maxLength={80}
                          value={f.details.city ?? ''}
                          onChange={setD('city')}
                        />
                      </Label>
                      <Label id="a-pin" label={t.pincode}>
                        <input
                          id="a-pin"
                          inputMode="numeric"
                          autoComplete="postal-code"
                          className={fieldInput}
                          maxLength={6}
                          value={f.details.pincode ?? ''}
                          onChange={setD('pincode')}
                        />
                      </Label>
                      <Label id="a-state" label={t.state}>
                        <select
                          id="a-state"
                          className={fieldInput}
                          value={f.details.stateCode ?? ''}
                          onChange={setD('stateCode')}
                        >
                          <option value="" />
                          {Object.entries(STATES).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </Label>
                    </div>
                  </fieldset>
                )}
                {(has('previous_school') || has('background')) && (
                  <fieldset className="flex flex-col gap-4 border-t border-line pt-5 first:border-t-0 first:pt-0">
                    <legend className="mb-1 font-display text-body font-semibold text-ink">
                      {t.about}
                    </legend>
                    <div className="grid gap-4 sm:grid-cols-2">
                      {has('previous_school') && (
                        <div className="sm:col-span-2">
                          <Label id="a-prev" label={t.previousSchool} optional>
                            <input
                              id="a-prev"
                              className={fieldInput}
                              maxLength={160}
                              value={f.details.previousSchool ?? ''}
                              onChange={setD('previousSchool')}
                            />
                          </Label>
                        </div>
                      )}
                      {has('background') && (
                        <>
                          <Label id="a-tongue" label={t.motherTongue} optional>
                            <input
                              id="a-tongue"
                              className={fieldInput}
                              maxLength={40}
                              value={f.details.motherTongue ?? ''}
                              onChange={setD('motherTongue')}
                            />
                          </Label>
                          <Label id="a-nat" label={t.nationality} optional>
                            <input
                              id="a-nat"
                              className={fieldInput}
                              maxLength={40}
                              placeholder="Indian"
                              value={f.details.nationality ?? ''}
                              onChange={setD('nationality')}
                            />
                          </Label>
                          <Label id="a-blood" label={t.bloodGroup} optional>
                            <select
                              id="a-blood"
                              className={fieldInput}
                              value={f.details.bloodGroup ?? ''}
                              onChange={setD('bloodGroup')}
                            >
                              <option value="" />
                              {['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((g) => (
                                <option key={g} value={g}>
                                  {g}
                                </option>
                              ))}
                            </select>
                          </Label>
                          <Label id="a-cat" label={t.category} optional hint={t.categoryHint}>
                            <select
                              id="a-cat"
                              className={fieldInput}
                              value={f.details.socialCategory ?? ''}
                              onChange={setD('socialCategory')}
                              aria-describedby="a-cat-hint"
                            >
                              <option value="" />
                              {Object.entries(t.categories).map(([k, v]) => (
                                <option key={k} value={k}>
                                  {v}
                                </option>
                              ))}
                            </select>
                          </Label>
                          <Label id="a-rel2" label={t.religion} optional>
                            <input
                              id="a-rel2"
                              className={fieldInput}
                              maxLength={40}
                              value={f.details.religion ?? ''}
                              onChange={setD('religion')}
                            />
                          </Label>
                        </>
                      )}
                    </div>
                  </fieldset>
                )}
                {has('health') && (
                  <fieldset className="flex flex-col gap-4 border-t border-line pt-5">
                    <legend className="mb-1 font-display text-body font-semibold text-ink">
                      {t.health}
                    </legend>
                    <p className="-mt-2 text-caption text-ink-muted">{t.healthLead}</p>
                    <Label id="a-dis" label={t.disability} optional>
                      <input
                        id="a-dis"
                        className={fieldInput}
                        maxLength={200}
                        value={f.details.disability ?? ''}
                        onChange={setD('disability')}
                      />
                    </Label>
                    <Label id="a-med" label={t.medicalNotes} optional>
                      <textarea
                        id="a-med"
                        rows={2}
                        className={cx(fieldInput, 'h-auto py-2')}
                        maxLength={500}
                        value={f.details.medicalNotes ?? ''}
                        onChange={setD('medicalNotes')}
                      />
                    </Label>
                  </fieldset>
                )}
                {questions.length > 0 && (
                  <fieldset className="flex flex-col gap-4 border-t border-line pt-5">
                    <legend className="mb-1 font-display text-body font-semibold text-ink">
                      {t.more}
                    </legend>
                    <CustomFields
                      fields={questions}
                      values={custom}
                      onChange={(k, v) => setCustom((cur) => ({ ...cur, [k]: v }))}
                      problems={problems}
                      idPrefix="aq"
                      oneColumn
                    />
                  </fieldset>
                )}
              </>
            )}

            {step === 'papers' && started && (
              <section aria-labelledby="papers-title" className="flex flex-col gap-4">
                <div>
                  <h2 id="papers-title" className="font-display text-lead font-semibold text-ink">
                    {papersOnly ? t.papersAsked : t.papers}
                  </h2>
                  <p className="text-body text-ink-muted">
                    {papersOnly ? t.papersAskedLead : t.papersLead}
                  </p>
                </div>
                {asked.length === 0 ? (
                  <p className="text-body text-ink-muted">{t.noPapersNeeded}</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {asked.map((p) => (
                      <PaperUpload
                        key={p.kind}
                        slug={slug}
                        session={started.session}
                        kind={p.kind}
                        title={p.title}
                        required={p.required}
                        note={p.note}
                        value={papers[p.kind]}
                        onChange={(u) =>
                          setPapers((cur) =>
                            u
                              ? { ...cur, [p.kind]: u }
                              : Object.fromEntries(
                                  Object.entries(cur).filter(([k]) => k !== p.kind),
                                ),
                          )
                        }
                      />
                    ))}
                  </ul>
                )}
                {!papersOnly && missingRequired.length > 0 && (
                  <p className="text-caption text-ink-muted">{t.laterPapers}</p>
                )}
              </section>
            )}

            {step === 'review' && (
              <section aria-labelledby="review-title" className="flex flex-col gap-5">
                <h2 id="review-title" className="font-display text-lead font-semibold text-ink">
                  {t.reviewTitle}
                </h2>
                <Review
                  title={t.child}
                  onEdit={() => go('child')}
                  rows={[
                    [t.childName, f.childName],
                    [t.dateOfBirth, f.dateOfBirth && dmyy(f.dateOfBirth)],
                    [t.gender, t.genders[f.gender]],
                    [t.classLabel, cls?.name],
                  ]}
                />
                <Review
                  title={t.parent}
                  onEdit={() => go('family')}
                  rows={[
                    [
                      t.parentName,
                      `${f.guardianName} (${t.relationships[f.guardianRelationship] ?? ''})`,
                    ],
                    [t.phone, phone.replace(/\D/g, '').slice(-10)],
                    [t.email, f.details.guardianEmail],
                    [t.secondParent, f.details.secondGuardianName],
                  ]}
                />
                <Review
                  title={t.home}
                  onEdit={() => go('home')}
                  rows={[
                    [
                      t.address,
                      [
                        f.details.addressLine,
                        f.details.city,
                        f.details.pincode,
                        f.details.stateCode && stateName(f.details.stateCode),
                      ]
                        .filter(Boolean)
                        .join(', '),
                    ],
                    [t.previousSchool, f.details.previousSchool],
                  ]}
                />
                <Review
                  title={t.papers}
                  onEdit={() => go('papers')}
                  rows={form.papers.map((p) => [
                    p.title,
                    papers[p.kind] ? papers[p.kind]?.fileName : p.required ? t.notYet : t.skipped,
                  ])}
                />
                <label className="flex items-start gap-3 rounded-xl border border-line p-4 text-body text-ink">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-[#04266d]"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span className="flex flex-col gap-1">
                    {t.consent}
                    <span className="text-caption text-ink-muted">{t.consentMore}</span>
                  </span>
                </label>
              </section>
            )}

            {error && (
              <p
                role="alert"
                className="rounded-md bg-signal-stop-tint px-3 py-2 text-body text-signal-stop-ink"
              >
                {error}
              </p>
            )}
          </div>

          {step !== 'mobile' && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper/60 px-5 py-4">
              {index > 1 ? (
                <Button variant="quiet" onClick={back}>
                  {t.back}
                </Button>
              ) : (
                <span />
              )}
              {step === 'review' || (papersOnly && step === 'papers') ? (
                <Button
                  disabled={busy || (papersOnly ? Object.keys(papers).length === 0 : !consent)}
                  onClick={() => void submit()}
                >
                  {papersOnly ? (
                    <FileCheck2 aria-hidden className="size-4" />
                  ) : (
                    <Check aria-hidden className="size-4" />
                  )}
                  {papersOnly ? t.sendPapers : t.submit}
                </Button>
              ) : (
                <Button
                  disabled={(step === 'child' && !childOk) || (step === 'family' && !familyOk)}
                  onClick={next}
                >
                  {t.continue}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {!invite && <StatusCheck slug={slug} />}
    </>
  );
}

function Review({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: (readonly [string, string | null | undefined])[] | [string, string | null | undefined][];
  onEdit: () => void;
}) {
  return (
    <div className="rounded-xl border border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <h3 className="text-body font-semibold text-ink">{title}</h3>
        <button
          type="button"
          onClick={onEdit}
          className="text-caption font-medium text-navy-950 hover:underline"
          aria-label={t.editSection(title)}
        >
          {t.edit}
        </button>
      </div>
      <dl className="grid gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[180px_1fr]">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-caption text-ink-muted">{k}</dt>
              <dd className="text-body text-ink">{v}</dd>
            </div>
          ))}
      </dl>
    </div>
  );
}

function StatusCheck({ slug }: { slug: string }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [list, setList] = useState<Status[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ applications: Status[] }>(`/public/apply/${slug}/status`, {
        phone,
        code,
      });
      setList(r.applications);
      setCode('');
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="check" className="panel flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 id="check" className="font-display text-lead font-semibold text-ink">
          {t.check}
        </h2>
        <p className="text-body text-ink-muted">{t.checkLead}</p>
      </div>
      <form onSubmit={(e) => void check(e)} className="flex flex-col gap-4" noValidate>
        <PhoneCode
          slug={slug}
          idPrefix="s"
          phone={phone}
          setPhone={setPhone}
          code={code}
          setCode={setCode}
        />
        {error && (
          <p role="alert" className="text-body text-signal-stop-ink">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="secondary"
          disabled={busy || code.length !== 6}
          className="self-start"
        >
          {t.checkSubmit}
        </Button>
      </form>
      {list && (
        <ul aria-live="polite" className="flex flex-col gap-3">
          {list.length === 0 ? (
            <li className="text-body text-ink-muted">{t.none}</li>
          ) : (
            list.map((a, i) => <StatusItem key={a.reference ?? i} slug={slug} a={a} />)
          )}
        </ul>
      )}
    </section>
  );
}

function StatusItem({ slug, a }: { slug: string; a: Status }) {
  const [papers, setPapers] = useState<Record<string, Uploaded>>({});
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!a.session) return;
    setError(null);
    try {
      await api.post(`/public/apply/${slug}/send-papers`, {
        session: a.session,
        papers: Object.values(papers).map(({ kind, ticket }) => ({ kind, ticket })),
      });
      setSent(true);
    } catch (e) {
      setError(errorOf(e));
    }
  };
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line p-4">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body font-medium text-ink">
          {t.statusFor(a.firstName, a.className)}
        </span>
        {a.reference && <span className="tabular text-caption text-ink-muted">{a.reference}</span>}
      </span>
      <span
        className={cx(
          'text-body',
          a.status === 'offered' || a.status === 'admitted'
            ? 'text-signal-go-ink'
            : a.status === 'papers_needed'
              ? 'text-signal-warn-ink'
              : 'text-ink-muted',
        )}
      >
        {t.statuses[a.status]}
        {a.offerUntil ? ` · ${t.offerUntil(dmy(a.offerUntil))}` : ''}
      </span>
      {a.session && a.papersNeeded.length > 0 && !sent && (
        <>
          <ul className="flex flex-col gap-2">
            {a.papersNeeded.map((p) => (
              <PaperUpload
                key={p.kind}
                slug={slug}
                session={a.session ?? ''}
                kind={p.kind}
                title={p.title}
                required
                note={p.note}
                value={papers[p.kind]}
                onChange={(u) => setPapers((cur) => (u ? { ...cur, [p.kind]: u } : cur))}
              />
            ))}
          </ul>
          <Button
            className="self-start"
            disabled={Object.keys(papers).length === 0}
            onClick={() => void send()}
          >
            {t.sendPapers}
          </Button>
        </>
      )}
      {sent && <span className="text-body text-signal-go-ink">{t.papersSentBody}</span>}
      {error && (
        <span role="alert" className="text-body text-signal-stop-ink">
          {error}
        </span>
      )}
    </li>
  );
}
