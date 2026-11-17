// Privacy and consent for one child (rule book §13.4 Consent at Entry, §16.5): each purpose the
// school has published a notice for, the notice in the app's language when the school wrote one,
// and this guardian's own decision, which they can change at any time.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app';
import { Button, Card, Loading, Note, Screen, s } from '../../lib/ui';
import type { Home } from '../index';

type Consent = {
  studentId: string;
  me: string;
  guardians: { personId: string; verified: unknown }[];
  purposes: {
    purpose: string;
    notices: { id: string; version: number; language: string; body: string }[];
    decisions: { guardianId: string; decision: 'granted' | 'withdrawn'; noticeVersion: number }[];
  }[];
};

export default function ConsentScreen() {
  const { t, language } = useApp();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const qc = useQueryClient();
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<Home>('/parent/home') });
  const child = home.data?.children.find((c) => c.personId === childId);
  const q = useQuery({
    queryKey: ['consent', childId],
    queryFn: () => api.get<Consent>(`/consent/students/${childId}`),
    enabled: !!childId,
  });
  const decide = useMutation({
    mutationFn: (v: { noticeId: string; decision: 'granted' | 'withdrawn' }) =>
      api.post(`/consent/students/${childId}`, {
        noticeId: v.noticeId,
        guardianId: q.data?.me,
        decision: v.decision,
        source: 'app',
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['consent', childId] }),
  });
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (q.isPending || home.isPending)
    return (
      <Screen title={t.consent} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  if (!q.data || !child)
    return (
      <Screen title={t.consent} right={back}>
        <Note>{q.isError || home.isError ? t.error : t.denied}</Note>
      </Screen>
    );

  const asked = q.data.purposes.filter((p) => p.notices.length > 0);
  return (
    <Screen title={t.consent} right={back}>
      <Text style={s.muted}>{child.name}</Text>
      <Text style={s.lead}>{t.consentLead}</Text>
      {asked.length === 0 && <Note>{t.consentNone}</Note>}
      {asked.length > 0 && !q.data.guardians.find((g) => g.personId === q.data.me)?.verified && (
        <Note>{t.consentUnverified}</Note>
      )}
      {asked.map((p) => {
        const notice =
          p.notices.find((n) => n.language === language) ??
          p.notices.find((n) => n.language === 'en') ??
          p.notices[0];
        const mine = p.decisions.find((d) => d.guardianId === q.data.me);
        // A newer notice than the one decided on asks again.
        const current = mine && notice && mine.noticeVersion >= notice.version ? mine : undefined;
        if (!notice) return null;
        return (
          <Card
            key={p.purpose}
            {...(current ? { tone: current.decision === 'granted' ? 'go' : 'warn' } : {})}
          >
            <Text style={s.label}>{t.consentPurposes[p.purpose] ?? p.purpose}</Text>
            <Text style={s.body}>{notice.body}</Text>
            <Text style={s.muted}>
              {!current
                ? t.consentUndecided
                : current.decision === 'granted'
                  ? t.consentAllowed
                  : t.consentWithdrawn}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={t.consentAllow}
                  kind={current?.decision === 'granted' ? 'secondary' : 'primary'}
                  disabled={decide.isPending || current?.decision === 'granted'}
                  onPress={() => decide.mutate({ noticeId: notice.id, decision: 'granted' })}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={t.consentWithdraw}
                  kind="secondary"
                  disabled={decide.isPending || current?.decision === 'withdrawn'}
                  onPress={() => decide.mutate({ noticeId: notice.id, decision: 'withdrawn' })}
                />
              </View>
            </View>
          </Card>
        );
      })}
      {decide.isError && <Note>{t.error}</Note>}
    </Screen>
  );
}
