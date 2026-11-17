// A child's hostel (docs/specs/HOSTEL.md): room and bed, recent roll calls, outpasses, and asking
// for one: dates, reason and who collects (a guardian on record or someone named).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiFailure } from '../../lib/api';
import { useApp } from '../../lib/app';
import { dayLabel } from '../../lib/lessons';
import { color } from '../../lib/theme';
import { Button, Card, Field, Loading, Note, Screen, s } from '../../lib/ui';
import type { Home } from '../index';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
type Child = {
  stay: { hostel: string; room: string; bedNo: number; since: string } | null;
  roll: { onDate: string; session: string; status: string }[];
  outpasses: {
    outpassId: string;
    leavesOn: string;
    backBy: string;
    reason: string;
    collector: string;
    state: string;
    overdue: boolean;
    decisionNote: string | null;
  }[];
  collectors: { personId: string; name: string; relationship: string }[];
};

export default function HostelScreen() {
  const { t } = useApp();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const qc = useQueryClient();
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<Home>('/parent/home') });
  const q = useQuery({
    queryKey: ['child-hostel', childId],
    queryFn: () => api.get<Child>(`/hostel/children/${childId}`),
    enabled: !!childId,
  });
  const child = home.data?.children.find((c) => c.personId === childId);
  const today = child?.day.onDate ?? '';
  const [asking, setAsking] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [who, setWho] = useState('');
  const [name, setName] = useState('');
  const [relation, setRelation] = useState('');
  const [phone, setPhone] = useState('');
  const refresh = () => void qc.invalidateQueries({ queryKey: ['child-hostel', childId] });
  const ask = useMutation({
    mutationFn: () =>
      api.post('/hostel/children/outpasses', {
        studentId: childId,
        leavesOn: from || today,
        backBy: to || from || today,
        reason,
        collector:
          who === 'other'
            ? { name, relation, phone: phone.replace(/\D/g, '').slice(-10) }
            : { guardianId: who },
      }),
    onSuccess: () => {
      setAsking(false);
      setReason('');
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (id: string) => api.post(`/hostel/outpasses/${id}/cancel`),
    onSuccess: refresh,
  });
  const title = child ? t.hostelTitle(child.name.split(' ')[0] ?? '') : t.hostel;
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (home.isPending || q.isPending) {
    return (
      <Screen title={title} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (q.isError || !child) {
    const denied = q.error instanceof ApiFailure && q.error.status === 403;
    return (
      <Screen title={title} right={back}>
        <Note>{denied || !child ? t.denied : t.error}</Note>
        {!denied && child && (
          <Button label={t.retry} kind="secondary" onPress={() => void q.refetch()} />
        )}
      </Screen>
    );
  }
  const d = q.data;
  if (!d.stay) {
    return (
      <Screen title={title} right={back}>
        <Card>
          <Text style={s.body}>{t.hostelNone}</Text>
        </Card>
      </Screen>
    );
  }
  const valid =
    (!from || DATE.test(from)) &&
    (!to || DATE.test(to)) &&
    reason.trim().length >= 3 &&
    (who === 'other'
      ? !!name.trim() && !!relation.trim() && phone.replace(/\D/g, '').length >= 10
      : !!who);
  const choices = [
    ...d.collectors.map((c) => ({ value: c.personId, label: c.name })),
    { value: 'other', label: t.someoneElse },
  ];
  return (
    <Screen title={title} right={back}>
      <Card>
        <Text style={[s.body, { fontWeight: '600' }]}>
          {t.hostelStay(d.stay.hostel, d.stay.room, d.stay.bedNo)}
        </Text>
      </Card>

      {d.roll.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={s.lead}>
            {t.hostelRoll}
          </Text>
          {d.roll.map((r) => (
            <Card
              key={`${r.onDate}-${r.session}`}
              {...(r.status === 'absent' ? { tone: 'warn' as const } : {})}
            >
              <Text style={s.body}>
                {dayLabel(t, r.onDate, today)} · {t.hostelSessions[r.session] ?? r.session}
              </Text>
              <Text
                style={{
                  ...s.muted,
                  color: r.status === 'absent' ? color.warnInk : color.inkMuted,
                }}
              >
                {t.hostelMarks[r.status] ?? r.status}
              </Text>
            </Card>
          ))}
        </View>
      )}

      <View style={{ gap: 8 }}>
        <Text accessibilityRole="header" style={s.lead}>
          {t.outpasses}
        </Text>
        {ask.isSuccess && <Note tone="go">{t.outpassSent}</Note>}
        {!asking ? (
          <Button label={t.askOutpass} kind="secondary" onPress={() => setAsking(true)} />
        ) : (
          <Card>
            <Field
              label={t.leavesOn}
              hint={t.dateHint}
              placeholder={today}
              value={from}
              onChangeText={setFrom}
            />
            <Field
              label={t.backBy}
              hint={t.dateHint}
              placeholder={from || today}
              value={to}
              onChangeText={setTo}
            />
            <Field
              label={t.reason}
              value={reason}
              onChangeText={setReason}
              multiline
              maxLength={300}
            />
            <Text style={s.label}>{t.collects}</Text>
            <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
              {choices.map((c) => (
                <Pressable
                  key={c.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: who === c.value }}
                  aria-checked={who === c.value}
                  onPress={() => setWho(c.value)}
                  style={{
                    minHeight: 44,
                    borderRadius: 8,
                    borderWidth: 1,
                    paddingHorizontal: 12,
                    justifyContent: 'center',
                    borderColor: who === c.value ? color.navy950 : color.lineStrong,
                    backgroundColor: who === c.value ? color.navy50 : color.surface,
                  }}
                >
                  <Text style={{ ...s.body, color: who === c.value ? color.navy950 : color.ink }}>
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {who === 'other' && (
              <>
                <Field label={t.collectorName} value={name} onChangeText={setName} />
                <Field label={t.collectorRelation} value={relation} onChangeText={setRelation} />
                <Field
                  label={t.collectorPhone}
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                />
              </>
            )}
            <Button
              label={t.send}
              disabled={!valid || ask.isPending}
              onPress={() => ask.mutate()}
            />
            {ask.isError && <Note>{t.error}</Note>}
          </Card>
        )}
        {d.outpasses.map((o) => (
          <Card key={o.outpassId} {...(o.overdue ? { tone: 'warn' as const } : {})}>
            <Text style={s.body}>
              {o.leavesOn === o.backBy
                ? dayLabel(t, o.leavesOn, today)
                : `${dayLabel(t, o.leavesOn, today)} – ${dayLabel(t, o.backBy, today)}`}
            </Text>
            <Text style={s.muted}>
              {[t.outpassStates[o.state] ?? o.state, o.collector, o.reason, o.decisionNote]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            {o.state === 'requested' && (
              <Button
                label={t.cancelOutpass}
                kind="quiet"
                disabled={cancel.isPending}
                onPress={() => cancel.mutate(o.outpassId)}
              />
            )}
          </Card>
        ))}
      </View>
    </Screen>
  );
}
