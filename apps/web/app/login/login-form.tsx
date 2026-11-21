'use client';

import { Avatar, Button } from '@campusverse/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type SyntheticEvent } from 'react';
import { ApiFailure, session } from '../../lib/api';
import { en } from '../../messages/en';

type Profile = { orgId: string; personId: string; orgName: string; personName: string };
const t = en.login;

const field =
  'h-12 w-full rounded-lg border border-line-strong bg-surface px-3.5 text-lead text-ink shadow-[var(--shadow-card)] outline-none transition-colors placeholder:text-ink-faint focus:border-navy-950';

/** Phone, then code, then (for shared phones or several schools) who you are signing in as. */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code' | 'app' | 'profile'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sms, setSms] = useState<{ to: string; text: string } | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const h = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(h);
  }, [wait]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const sendCode = (e: FormEvent | SyntheticEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await session.post<{ simulated?: { to: string; text: string } }>('otp', { phone });
      setSms(r.simulated ?? null);
      setCode('');
      setWait(30);
      setStep('code');
    });
  };

  const verify = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await session.post<
        { profiles: Profile[]; chosen: boolean } | { mfaRequired: true }
      >('verify', { phone, code });
      if ('mfaRequired' in r) {
        // Two-step sign-in is on: the code from the authenticator app comes next.
        setCode('');
        setStep('app');
      } else signedIn(r);
    });
  };

  const verifyApp = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      signedIn(await session.post<{ profiles: Profile[]; chosen: boolean }>('mfa', { code }));
    });
  };

  const signedIn = (r: { profiles: Profile[]; chosen: boolean }) => {
    if (r.chosen) router.replace(next);
    // Signed in, but invited and not yet onboarded: no organisation, so no profile.
    else if (r.profiles.length === 0) router.replace('/onboarding');
    else {
      setProfiles(r.profiles);
      setStep('profile');
    }
  };

  const choose = (p: Profile) =>
    void run(async () => {
      await session.post('profile', { orgId: p.orgId, personId: p.personId });
      router.replace(next);
    });

  return (
    <div className="flex flex-col gap-5">
      {step === 'phone' && (
        <form onSubmit={sendCode} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">{t.phoneLabel}</span>
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
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
              />
            </span>
            <span className="text-caption text-ink-muted">{t.phoneHint}</span>
          </label>
          <Button type="submit" size="lg" disabled={busy}>
            {t.sendCode}
          </Button>
        </form>
      )}

      {step === 'code' && sms && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border border-signal-warn/40 bg-signal-warn-tint px-4 py-3"
        >
          <span className="text-caption font-semibold text-signal-warn-ink">
            {t.simulatedSms} · {sms.to}
          </span>
          <span className="text-body text-ink">{sms.text}</span>
          <span className="text-caption text-ink-muted">{t.simulatedHint}</span>
        </div>
      )}

      {step === 'code' && (
        <form onSubmit={verify} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">{t.codeLabel}</span>
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
            <span className="text-caption text-ink-muted">{t.codeHint(phone)}</span>
          </label>
          <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
            {t.verify}
          </Button>
          <div className="flex items-center justify-between gap-3">
            <Button variant="quiet" onClick={() => setStep('phone')}>
              {t.changeNumber}
            </Button>
            <Button variant="quiet" disabled={busy || wait > 0} onClick={(e) => sendCode(e)}>
              {wait > 0 ? t.resendIn(wait) : t.resend}
            </Button>
          </div>
        </form>
      )}

      {step === 'app' && (
        <form onSubmit={verifyApp} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-body font-medium text-ink">{t.appCodeLabel}</span>
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
            <span className="text-caption text-ink-muted">{t.appCodeHint}</span>
          </label>
          <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
            {t.verify}
          </Button>
          <Button variant="quiet" onClick={() => setStep('phone')}>
            {t.startAgain}
          </Button>
        </form>
      )}

      {step === 'profile' && (
        <div className="flex flex-col gap-3">
          <p className="text-body font-medium text-ink">{t.chooseProfile}</p>
          <ul className="flex flex-col gap-2">
            {profiles.map((p) => (
              <li key={`${p.orgId}:${p.personId}`}>
                <button
                  type="button"
                  onClick={() => choose(p)}
                  disabled={busy}
                  className="panel flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:border-navy-200 hover:bg-navy-50"
                >
                  <Avatar name={p.personName} />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body font-medium text-ink">{p.personName}</span>
                    <span className="text-caption text-ink-muted">{p.orgName}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
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
  );
}
