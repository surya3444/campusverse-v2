'use client';

// Self-serve sign-up (rule book §11 "Self-serve onboarding"): who you are and what you run, then
// the code sent to your mobile; then onboarding builds the organisation. Someone already using
// Campusverse simply signs in.
import { STATES } from '@campusverse/rules';
import { Button, cx } from '@campusverse/ui';
import { Building2, GraduationCap, School } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiFailure, session } from '../../lib/api';
import { en } from '../../messages/en';

const t = en.signup;
const field =
  'h-12 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-lead text-ink shadow-[var(--shadow-card)] outline-none transition-colors placeholder:text-ink-faint focus:border-navy-950';
const KINDS = [
  { value: 'school', Icon: School },
  { value: 'college', Icon: Building2 },
  { value: 'university', Icon: GraduationCap },
] as const;
type Kind = (typeof KINDS)[number]['value'];

export function SignupForm({
  invite,
}: {
  /** An email invite's link: the address is fixed and no approval is needed. */
  invite: { name: string; email: string; token: string } | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<'details' | 'code'>('details');
  const [v, setV] = useState({
    name: invite?.name ?? '',
    phone: '',
    email: invite?.email ?? '',
    organisation: '',
    kind: 'school' as Kind,
    stateCode: 'KA',
  });
  const [code, setCode] = useState('');
  const [sms, setSms] = useState<{ to: string; text: string } | null>(null);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (wait <= 0) return;
    const h = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(h);
  }, [wait]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(t.errors[e instanceof ApiFailure ? e.code : 'error'] ?? t.errors.error ?? null);
    } finally {
      setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      const r = await session.post<{ simulated?: { to: string; text: string } }>('signup', {
        ...v,
        email: v.email.trim() || null,
        ...(invite ? { invite: invite.token } : {}),
      });
      setSms(r.simulated ?? null);
      setCode('');
      setWait(30);
      setStep('code');
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };
  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await session.post<{ profiles: unknown[]; chosen: boolean }>('verify', {
        phone: v.phone,
        code,
      });
      // New here: onboarding (or, without an invite, the wait for approval). Already a member: sign in.
      router.replace(r.profiles.length === 0 ? '/onboarding' : r.chosen ? '/' : '/login');
    });
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV({ ...v, [k]: e.target.value });

  return (
    <div className="flex flex-col gap-5">
      {step === 'details' ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-body font-medium text-ink">{t.kind}</legend>
            <div className="grid grid-cols-3 gap-2">
              {KINDS.map(({ value, Icon }) => {
                const on = v.kind === value;
                return (
                  <label
                    key={value}
                    className={cx(
                      'flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-body font-medium transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-navy-950',
                      on
                        ? 'border-navy-950 bg-navy-50 text-navy-950'
                        : 'border-line-strong text-ink hover:border-navy-950/40',
                    )}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={value}
                      checked={on}
                      onChange={() => setV({ ...v, kind: value })}
                      className="sr-only"
                    />
                    <Icon
                      aria-hidden
                      className={cx('size-5', on ? 'text-navy-950' : 'text-ink-muted')}
                    />
                    {t.kinds[value]}
                  </label>
                );
              })}
            </div>
          </fieldset>
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">{t.organisation(v.kind)}</span>
            <input
              className={field}
              required
              minLength={2}
              autoComplete="organization"
              value={v.organisation}
              onChange={set('organisation')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">{t.state}</span>
            <select className={field} value={v.stateCode} onChange={set('stateCode')}>
              {Object.entries(STATES).map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">{t.name}</span>
            <input
              className={field}
              required
              minLength={2}
              autoComplete="name"
              value={v.name}
              onChange={set('name')}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">{en.login.phoneLabel}</span>
            <span className="relative flex items-center">
              <span
                aria-hidden
                className="tabular pointer-events-none absolute left-3.5 text-lead text-ink-muted"
              >
                +91
              </span>
              <input
                className={`${field} tabular pl-14 tracking-wide`}
                inputMode="tel"
                autoComplete="tel"
                required
                value={v.phone}
                onChange={set('phone')}
                placeholder="98765 43210"
              />
            </span>
            <span className="text-caption text-ink-muted">{en.login.phoneHint}</span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">{t.email}</span>
            <input
              className={field}
              type="email"
              autoComplete="email"
              value={v.email}
              readOnly={!!invite}
              onChange={set('email')}
            />
          </label>
          <Button type="submit" size="lg" disabled={busy}>
            {t.create}
          </Button>
          <p className="text-caption text-ink-muted">
            {t.terms} {!invite && t.approvalNote}
          </p>
        </form>
      ) : (
        <>
          {sms && (
            <div
              role="status"
              className="flex flex-col gap-1 rounded-md border border-signal-warn/40 bg-signal-warn-tint px-4 py-3"
            >
              <span className="text-caption font-semibold text-signal-warn-ink">
                {en.login.simulatedSms} · {sms.to}
              </span>
              <span className="text-body text-ink">{sms.text}</span>
              <span className="text-caption text-ink-muted">{en.login.simulatedHint}</span>
            </div>
          )}
          <form onSubmit={verify} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-body font-medium text-ink">{en.login.codeLabel}</span>
              <input
                className={`${field} tabular h-14 text-center font-display text-[1.75rem] tracking-[0.5em]`}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <span className="text-caption text-ink-muted">{en.login.codeHint(v.phone)}</span>
            </label>
            <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
              {t.confirm}
            </Button>
            <div className="flex items-center justify-between px-4">
              <button
                type="button"
                className="text-body font-medium text-navy-950 hover:underline"
                onClick={() => (setStep('details'), setError(null))}
              >
                {t.back}
              </button>
              <button
                type="button"
                className="text-body text-ink-muted enabled:text-navy-950 enabled:hover:underline"
                disabled={wait > 0 || busy}
                onClick={() => void send()}
              >
                {wait > 0 ? en.login.resendIn(wait) : en.login.resend}
              </button>
            </div>
          </form>
        </>
      )}
      {error && (
        <p role="alert" className="text-body text-signal-stop-ink">
          {error}
        </p>
      )}
    </div>
  );
}
