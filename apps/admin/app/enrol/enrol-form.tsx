'use client';

import { Button } from '@campusverse/ui';
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { useState } from 'react';
import { session } from '../../lib/api';
import { Notice } from '../../lib/ui';
import { en } from '../../messages/en';
import { AuthCard } from '../sign-in/sign-in-form';

const t = en.signIn;

export function EnrolForm({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const enrol = async () => {
    setBusy(true);
    setError(null);
    try {
      const { challengeId, options } = (await session('enrol-options', { token })) as {
        challengeId: string;
        options: PublicKeyCredentialCreationOptionsJSON;
      };
      const response = await startRegistration({ optionsJSON: options });
      await session('enrol-verify', { token, challengeId, response });
      window.location.assign('/');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <AuthCard title={t.enrolTitle} lead={token ? t.enrolLead : t.noLink}>
      <Notice error={error} />
      {token && (
        <Button onClick={() => void enrol()} disabled={busy}>
          {t.enrolAction}
        </Button>
      )}
    </AuthCard>
  );
}
