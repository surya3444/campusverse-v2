// Apply for leave for one child, and see that child's recent requests.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app';
import { color } from '../../lib/theme';
import { Button, Card, Field, Loading, Note, Screen, s } from '../../lib/ui';
import type { Home } from '../index';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function LeaveScreen() {
  const { t } = useApp();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const qc = useQueryClient();
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<Home>('/parent/home') });
  const child = home.data?.children.find((c) => c.personId === childId);
  const today = child?.day.onDate ?? '';
  const [kind, setKind] = useState<'leave' | 'medical'>('leave');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const send = useMutation({
    mutationFn: () =>
      api.post('/school/attendance/leave', {
        studentId: childId,
        kind,
        from: from || today,
        to: to || from || today,
        reason,
      }),
    onSuccess: () => {
      setReason('');
      void qc.invalidateQueries({ queryKey: ['home'] });
    },
  });
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (home.isPending) {
    return (
      <Screen title={t.leaveTitle} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (!child) {
    return (
      <Screen title={t.leaveTitle} right={back}>
        <Note>{home.isError ? t.error : t.denied}</Note>
      </Screen>
    );
  }
  const valid = (!from || DATE.test(from)) && (!to || DATE.test(to)) && reason.trim().length >= 3;

  return (
    <Screen title={t.leaveTitle} right={back}>
      <Text style={s.muted}>{child.name}</Text>
      <Card>
        <Text style={s.label}>{t.leaveKind}</Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 8 }}>
          {(['leave', 'medical'] as const).map((k) => (
            <Pressable
              key={k}
              accessibilityRole="radio"
              accessibilityState={{ checked: kind === k }}
              onPress={() => setKind(k)}
              style={{
                flex: 1,
                minHeight: 44,
                borderRadius: 8,
                borderWidth: 1,
                alignItems: 'center',
                justifyContent: 'center',
                borderColor: kind === k ? color.navy950 : color.lineStrong,
                backgroundColor: kind === k ? color.navy50 : color.surface,
              }}
            >
              <Text style={{ ...s.body, color: kind === k ? color.navy950 : color.ink }}>
                {t.leaveKinds[k]}
              </Text>
            </Pressable>
          ))}
        </View>
        <Field
          label={t.from}
          hint={t.dateHint}
          placeholder={today}
          value={from}
          onChangeText={setFrom}
        />
        <Field
          label={t.to}
          hint={t.dateHint}
          placeholder={from || today}
          value={to}
          onChangeText={setTo}
        />
        <Field label={t.reason} value={reason} onChangeText={setReason} multiline maxLength={500} />
        <Button label={t.send} disabled={!valid || send.isPending} onPress={() => send.mutate()} />
      </Card>
      {send.isSuccess && <Note tone="go">{t.leaveSent}</Note>}
      {send.isError && <Note>{t.error}</Note>}

      {child.day.leave.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={s.lead}>
            {t.leaveRequests}
          </Text>
          {child.day.leave.map((l) => (
            <Card key={l.id}>
              <Text style={s.body}>
                {t.leaveKinds[l.kind]} · {l.from === l.to ? l.from : `${l.from} – ${l.to}`}
              </Text>
              <Text style={s.muted}>{t.leaveStates[l.status] ?? l.status}</Text>
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
