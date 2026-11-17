// Phone OTP, then the shared-phone profile picker. _layout shows it while no profile is chosen.
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { api, ApiFailure, session, type Profile, type Tokens } from './api';
import { deviceId, useApp } from './app';
import { color } from './theme';
import { Button, Card, Field, Note, Screen, s } from './ui';

export function SignIn() {
  const { t, session: current } = useApp();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sms, setSms] = useState<{ to: string; text: string } | null>(null);
  const e164 = `+91${phone.replace(/\D/g, '').slice(-10)}`;

  // Signed in on this phone but no profile chosen (or switching profile): list them again.
  useEffect(() => {
    if (current && !current.profile && !profiles) {
      api.get<Profile[]>('/auth/profiles').then(setProfiles, () => void session.save(null));
    }
  }, [current, profiles]);

  const fail = (e: unknown) => {
    const code = e instanceof ApiFailure ? e.code : 'error';
    setError(
      code === 'invalid_code'
        ? t.badCode
        : code === 'rate_limited'
          ? t.tooMany
          : code === 'invalid_input'
            ? t.badPhone
            : t.error,
    );
  };
  const run = (work: () => Promise<void>) => async () => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const choose = (tokens: Tokens, p: Profile) => session.save({ tokens, profile: p });

  if (current && profiles) {
    return (
      <Screen title={t.chooseProfile}>
        <Text style={s.muted}>{t.chooseProfileHint}</Text>
        {profiles.map((p) => (
          <Pressable
            key={`${p.orgId}:${p.personId}`}
            accessibilityRole="button"
            onPress={() => void choose(current.tokens, p)}
            style={{
              backgroundColor: color.surface,
              borderWidth: 1,
              borderColor: color.line,
              borderRadius: 12,
              padding: 16,
            }}
          >
            <Text style={s.lead}>{p.personName}</Text>
            <Text style={s.muted}>{p.orgName}</Text>
          </Pressable>
        ))}
      </Screen>
    );
  }

  return (
    <Screen title={t.signInTitle}>
      <Card>
        {step === 'phone' ? (
          <View style={{ gap: 14 }}>
            <Field
              label={t.phoneLabel}
              hint={t.phoneHint}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              maxLength={14}
            />
            <Button
              label={t.sendCode}
              disabled={busy || phone.replace(/\D/g, '').length < 10}
              onPress={run(async () => {
                const r = await api.public<{ simulated?: { to: string; text: string } }>(
                  '/auth/otp/request',
                  { phone: e164 },
                );
                setSms(r.simulated ?? null);
                setStep('code');
              })}
            />
          </View>
        ) : (
          <View style={{ gap: 14 }}>
            {sms && (
              <Note tone="warn">
                {`${t.simulatedSms} · ${sms.to}\n${sms.text}\n${t.simulatedHint}`}
              </Note>
            )}
            <Field
              label={t.codeLabel}
              hint={t.codeHint(e164.slice(-4))}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
            />
            <Button
              label={t.verify}
              disabled={busy || code.length !== 6}
              onPress={run(async () => {
                const res = await api.public<{ tokens: Tokens; profiles: Profile[] }>(
                  '/auth/otp/verify',
                  {
                    phone: e164,
                    code,
                    device: { id: await deviceId(), label: `Campusverse app (${Platform.OS})` },
                  },
                );
                const [only] = res.profiles;
                if (res.profiles.length === 1 && only) await choose(res.tokens, only);
                else {
                  setProfiles(res.profiles);
                  await session.save({ tokens: res.tokens, profile: null });
                }
              })}
            />
            <Button label={t.changeNumber} kind="quiet" onPress={() => setStep('phone')} />
          </View>
        )}
      </Card>
      {error && <Note>{error}</Note>}
    </Screen>
  );
}
