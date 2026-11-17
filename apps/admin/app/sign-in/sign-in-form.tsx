'use client';

import { Button } from '@campusverse/ui';
import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { useState, type FormEvent } from 'react';
import { session } from '../../lib/api';
import { Field, Notice, field } from '../../lib/ui';
import { en } from '../../messages/en';

const t = en.signIn;

export function SignInForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = (await session('sign-in-options', { email })) as {
        challengeId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
      };
      const response = await startAuthentication({ optionsJSON: options });
      await session('sign-in-verify', { challengeId, response });
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.assign(next?.startsWith('/') && !next.startsWith('//') ? next : '/');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <AuthCard title={t.title} lead={t.lead}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t.email}>
          <input
            type="email"
            required
            autoComplete="username webauthn"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={field}
          />
        </Field>
        <Notice error={error} />
        <Button type="submit" disabled={busy}>
          {t.action}
        </Button>
      </form>
    </AuthCard>
  );
}

export function AuthCard({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <main id="main" className="flex min-h-[80dvh] items-center justify-center px-4">
      <div className="panel flex w-full max-w-sm flex-col gap-5 p-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-title font-semibold text-ink">{title}</h1>
          <p className="text-body text-ink-muted">{lead}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
