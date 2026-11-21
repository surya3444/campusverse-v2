'use client';

// Two-step sign-in (rule book §12.4 decision 10, "MFA for staff"): scan the QR code with an
// authenticator app, type its first code to switch it on; switching off needs a current code.
import { Announcer, Button, Pill, Section, StatePanel } from '@campusverse/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiFailure, api } from '../../../../lib/api';
import { en } from '../../../../messages/en';
import { fieldInput } from '../../common/custom-fields';

const t = en.twoStep;
const fail = (e: unknown) =>
  (e instanceof ApiFailure ? t.errors[e.code] : undefined) ?? t.errors.error ?? '';

export function TwoStep() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['mfa'],
    queryFn: () => api.get<{ enabled: boolean }>('/auth/mfa'),
  });
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [turningOff, setTurningOff] = useState(false);
  const [code, setCode] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const done = async (msg: string) => {
    setSetup(null);
    setTurningOff(false);
    setCode('');
    setNote(msg);
    await qc.invalidateQueries({ queryKey: ['mfa'] });
  };
  const start = useMutation({
    mutationFn: () => api.post<{ secret: string; qrSvg: string }>('/auth/mfa/setup', {}),
    onSuccess: (r) => {
      setNote(null);
      setSetup(r);
    },
  });
  const confirm = useMutation({
    mutationFn: () => api.post('/auth/mfa/confirm', { code }),
    onSuccess: () => done(t.on),
  });
  const off = useMutation({
    mutationFn: () => api.post('/auth/mfa/disable', { code }),
    onSuccess: () => done(t.off),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    (setup ? confirm : off).mutate();
  };
  const error = start.error ?? confirm.error ?? off.error;

  return (
    <Section
      id="two-step"
      title={t.title}
      description={t.lead}
      actions={
        status.data ? (
          <Pill tone={status.data.enabled ? 'go' : 'neutral'}>
            {status.data.enabled ? t.statusOn : t.statusOff}
          </Pill>
        ) : undefined
      }
    >
      <Announcer message={note} />
      {status.error ? (
        <StatePanel kind="error" title={en.states.error.title} />
      ) : !status.data ? null : setup || turningOff ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          {setup && (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
                alt={t.qrAlt}
                width={176}
                height={176}
                className="rounded-lg border border-line bg-white p-2"
              />
              <ol className="flex list-decimal flex-col gap-2 pl-5 text-body text-ink">
                <li>{t.step1}</li>
                <li>
                  {t.step2}
                  <span className="mt-1 block font-mono text-caption break-all text-ink">
                    {setup.secret.match(/.{1,4}/g)?.join(' ')}
                  </span>
                </li>
                <li>{t.step3}</li>
              </ol>
            </div>
          )}
          {turningOff && <p className="text-body text-ink">{t.offAsk}</p>}
          <label className="flex max-w-xs flex-col gap-1.5">
            <span className="text-caption font-medium text-ink">{t.codeLabel}</span>
            <input
              className={`${fieldInput} tabular tracking-[0.3em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {error && (
            <p role="alert" className="text-body text-signal-stop-ink">
              {fail(error)}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant={turningOff ? 'danger' : 'primary'}
              disabled={code.length !== 6 || confirm.isPending || off.isPending}
            >
              {turningOff ? t.turnOff : t.turnOn}
            </Button>
            <Button
              variant="quiet"
              onClick={() => {
                setSetup(null);
                setTurningOff(false);
                setCode('');
                confirm.reset();
                off.reset();
              }}
            >
              {t.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink-muted">{status.data.enabled ? t.onBody : t.offBody}</p>
          <div>
            {status.data.enabled ? (
              <Button variant="secondary" onClick={() => setTurningOff(true)}>
                {t.turnOff}
              </Button>
            ) : (
              <Button onClick={() => start.mutate()} disabled={start.isPending}>
                <ShieldCheck aria-hidden />
                {t.setUp}
              </Button>
            )}
          </div>
          {start.error && (
            <p role="alert" className="text-body text-signal-stop-ink">
              {fail(start.error)}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}
