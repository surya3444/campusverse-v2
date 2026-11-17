'use client';

// The family's side of the online form: details, the owner's questions, a code to the mobile
// number, then submit. "Check an application" shows where their applications stand.
import type { Field } from '@campusverse/platform-fields';
import type { FamilyStatus, PublicForm } from '@campusverse/school-admissions';
import { Button, cx } from '@campusverse/ui';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { ApiFailure, api } from '../../../lib/api';
import { en } from '../../../messages/en';
import { CustomFields, fieldInput, type Values } from '../../(school)/common/custom-fields';

const t = en.apply;
type Simulated = { simulated?: { text: string } };
type Status = {
  reference: string | null;
  firstName: string;
  className: string;
  status: FamilyStatus;
  offerUntil: string | null;
};
const dmy = (d: string) =>
  new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );
const errorOf = (e: unknown) =>
  (e instanceof ApiFailure ? t.errors[e.code] : undefined) ?? t.errors.error ?? '';

function Label({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-ink">
        {label}
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
}: {
  slug: string;
  idPrefix: string;
  phone: string;
  setPhone: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
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
      <Label id={`${idPrefix}-phone`} label={t.phone} hint={t.phoneHint}>
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
          className={fieldInput}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </Label>
      <div aria-live="polite" className="sm:col-span-2 flex flex-col gap-1 text-caption">
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

export function ApplyForm({ slug, form }: { slug: string; form: PublicForm }) {
  const blank = {
    childName: '',
    dateOfBirth: '',
    gender: '',
    classId: form.classes[0]?.classId ?? '',
    guardianName: '',
    guardianRelationship: 'mother',
  };
  const [f, setF] = useState(blank);
  const [custom, setCustom] = useState<Values>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    kind: 'received' | 'duplicate';
    reference: string | null;
  } | null>(null);
  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));
  const cls = form.classes.find((c) => c.classId === f.classId);
  const questions: Field[] = form.questions.map((q, i) => ({
    ...q,
    id: q.key,
    entity: 'admission',
    position: i,
    retired: false,
  }));
  const ready =
    f.childName.trim() &&
    f.dateOfBirth &&
    f.gender &&
    f.classId &&
    f.guardianName.trim() &&
    code.length === 6 &&
    consent;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setProblems({});
    try {
      const r = await api.post<{ status: 'received' | 'duplicate'; reference: string | null }>(
        `/public/apply/${slug}`,
        { ...f, phone, code, custom, consent: true },
      );
      setDone({ kind: r.status, reference: r.reference });
      setCode('');
    } catch (err) {
      if (err instanceof ApiFailure && err.code === 'values')
        setProblems((err.details as { problems?: Record<string, string> } | null)?.problems ?? {});
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="flex flex-col gap-2">
        <p className="text-caption font-medium text-ink-muted">{t.year(form.yearLabel)}</p>
        <h1 className="text-title font-semibold text-ink">{form.title}</h1>
        {form.intro && <p className="whitespace-pre-line text-body text-ink-muted">{form.intro}</p>}
      </header>

      {done ? (
        <section role="status" className="panel flex flex-col gap-4 p-5">
          <p className="flex items-start gap-3">
            <CheckCircle2 aria-hidden className="size-6 shrink-0 text-signal-go" />
            <span className="flex flex-col gap-1">
              <span className="text-lead font-semibold text-ink">
                {done.kind === 'received' ? t.received : t.duplicate}
              </span>
              <span className="text-body text-ink">
                {done.kind === 'received'
                  ? t.receivedBody(done.reference ?? '')
                  : t.duplicateBody(done.reference ?? '')}
              </span>
            </span>
          </p>
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => {
              setDone(null);
              setF(blank);
              setCustom({});
              setConsent(false);
            }}
          >
            {t.another}
          </Button>
        </section>
      ) : !form.accepting ? (
        <section role="status" className="panel flex items-start gap-3 p-5">
          <CircleAlert aria-hidden className="size-5 shrink-0 text-signal-warn" />
          <span className="flex flex-col gap-1">
            <span className="text-body font-semibold text-ink">{t.closed}</span>
            <span className="text-body text-ink-muted">{t.closedBody}</span>
          </span>
        </section>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="panel flex flex-col gap-6 p-5" noValidate>
          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 text-lead font-semibold text-ink">{t.child}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Label id="a-child" label={t.childName}>
                <input
                  id="a-child"
                  autoComplete="off"
                  className={fieldInput}
                  value={f.childName}
                  onChange={set('childName')}
                  maxLength={200}
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
                {...(cls?.age
                  ? {
                      hint: t.ageHint(
                        cls.age.minYears,
                        dmy(`${form.yearLabel.slice(0, 4)}-${cls.age.cutOff}`),
                      ),
                    }
                  : {})}
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
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-4">
            <legend className="mb-3 text-lead font-semibold text-ink">{t.parent}</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Label id="a-parent" label={t.parentName}>
                <input
                  id="a-parent"
                  autoComplete="name"
                  className={fieldInput}
                  value={f.guardianName}
                  onChange={set('guardianName')}
                  maxLength={200}
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
            </div>
            <PhoneCode
              slug={slug}
              idPrefix="a"
              phone={phone}
              setPhone={setPhone}
              code={code}
              setCode={setCode}
            />
          </fieldset>

          {questions.length > 0 && (
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-3 text-lead font-semibold text-ink">{t.more}</legend>
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

          <label className="flex items-start gap-3 text-body text-ink">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            {t.consent}
          </label>
          {error && (
            <p role="alert" className="text-body text-signal-stop-ink">
              {error}
            </p>
          )}
          <Button type="submit" disabled={!ready || busy} className="self-start">
            {t.submit}
          </Button>
        </form>
      )}

      <StatusCheck slug={slug} />
    </>
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
        <h2 id="check" className="text-lead font-semibold text-ink">
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
        <ul aria-live="polite" className="flex flex-col divide-y divide-line">
          {list.length === 0 ? (
            <li className="py-2 text-body text-ink-muted">{t.none}</li>
          ) : (
            list.map((a, i) => (
              <li key={a.reference ?? i} className="flex flex-col gap-0.5 py-2">
                <span className="text-body font-medium text-ink">
                  {t.statusFor(a.firstName, a.className)}
                </span>
                <span
                  className={cx(
                    'text-body',
                    a.status === 'offered' ? 'text-signal-go-ink' : 'text-ink-muted',
                  )}
                >
                  {t.statuses[a.status]}
                  {a.offerUntil ? ` · ${t.offerUntil(dmy(a.offerUntil))}` : ''}
                  {a.reference ? ` · ${a.reference}` : ''}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
