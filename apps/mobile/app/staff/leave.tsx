// A staff member's own leave (docs/specs/STAFF_LEAVE.md, step 2): what's left of each type, ask
// for leave with the days it counts, and their requests with Cancel. The principal decides on the
// web; approved leave goes into the register there.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { ApiFailure, api } from '../../lib/api';
import { useApp } from '../../lib/app';
import { days, type LeaveType, type MyLeave } from '../../lib/leave';
import { color } from '../../lib/theme';
import { Button, Card, Field, Loading, Note, Screen, s } from '../../lib/ui';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const istToday = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export default function StaffLeaveScreen() {
  const { t } = useApp();
  const qc = useQueryClient();
  const school = useQuery({
    queryKey: ['institutions'],
    queryFn: () => api.get<{ id: string }[]>('/school/setup/institutions'),
  });
  const id = school.data?.[0]?.id;
  const mine = useQuery({
    queryKey: ['staff-leave', id],
    queryFn: () => api.get<MyLeave>(`/staff-leave/me?institutionId=${id}`),
    enabled: !!id,
  });
  const types = useQuery({
    queryKey: ['leave-types', id],
    queryFn: () => api.get<LeaveType[]>(`/staff-leave/types?institutionId=${id}`),
    enabled: !!id,
  });
  const today = istToday();
  const [typeId, setTypeId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const active = types.data?.filter((x) => x.active) ?? [];
  const type = active.find((x) => x.id === typeId) ?? active[0];
  const f = from || today;
  const tt = to || f;
  const canHalf = !!type?.halfDay && f === tt;
  const datesOk = DATE.test(f) && DATE.test(tt) && tt >= f;
  const body = {
    institutionId: id,
    typeId: type?.id,
    from: f,
    to: tt,
    halfDay: canHalf && halfDay,
  };
  const quote = useQuery({
    queryKey: ['leave-quote', body],
    queryFn: () => api.post<{ days: number; left: number | null }>('/staff-leave/quote', body),
    enabled: !!id && !!type && datesOk,
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['staff-leave'] });
  const send = useMutation({
    mutationFn: () => api.post('/staff-leave/requests', { ...body, reason }),
    onSuccess: () => {
      setReason('');
      refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (requestId: string) => api.post(`/staff-leave/requests/${requestId}/cancel`, {}),
    onSuccess: refresh,
  });
  const errorOf = (e: unknown) =>
    (e instanceof ApiFailure && t.leaveErrors[e.code]) || (e ? t.error : null);
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (school.isPending || mine.isPending || types.isPending) {
    return (
      <Screen title={t.myLeave} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (!mine.data || !types.data) {
    const denied = mine.error instanceof ApiFailure && mine.error.status === 403;
    return (
      <Screen title={t.myLeave} right={back}>
        <Note>{denied ? t.denied : t.error}</Note>
      </Screen>
    );
  }
  const byId = new Map(types.data.map((x) => [x.id, x]));
  const q = quote.data;

  return (
    <Screen title={t.myLeave} right={back}>
      <Card>
        {mine.data.balances
          .filter((b) => byId.get(b.typeId)?.active)
          .map((b) => (
            <Text key={b.typeId} style={[s.body, { fontVariant: ['tabular-nums'] }]}>
              {t.leaveLeft(
                byId.get(b.typeId)?.name ?? '',
                b.left === null ? t.noLimit : days(b.left),
              )}
            </Text>
          ))}
      </Card>

      <Text accessibilityRole="header" style={s.lead}>
        {t.askLeave}
      </Text>
      <Card>
        <Text style={s.label}>{t.leaveType}</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          {active.map((x) => (
            <Pressable
              key={x.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: type?.id === x.id }}
              aria-checked={type?.id === x.id}
              onPress={() => setTypeId(x.id)}
              style={{
                minHeight: 44,
                borderRadius: 8,
                borderWidth: 1,
                paddingHorizontal: 12,
                justifyContent: 'center',
                borderColor: type?.id === x.id ? color.navy950 : color.lineStrong,
                backgroundColor: type?.id === x.id ? color.navy50 : color.surface,
              }}
            >
              <Text style={{ ...s.body, color: type?.id === x.id ? color.navy950 : color.ink }}>
                {x.name} ({x.code})
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
        <Field label={t.to} hint={t.dateHint} placeholder={f} value={to} onChangeText={setTo} />
        {canHalf && (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: halfDay }}
            aria-checked={halfDay}
            onPress={() => setHalfDay(!halfDay)}
            style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                borderWidth: 2,
                borderColor: color.navy950,
                backgroundColor: halfDay ? color.navy950 : color.surface,
              }}
            />
            <Text style={s.body}>{t.halfDay}</Text>
          </Pressable>
        )}
        <Field label={t.reason} value={reason} onChangeText={setReason} multiline maxLength={300} />
        <Text accessibilityLiveRegion="polite" style={[s.muted, { fontVariant: ['tabular-nums'] }]}>
          {q
            ? q.days === 0
              ? t.leaveErrors.no_working_days
              : [
                  t.leaveCounts(days(q.days)),
                  q.left === null ? null : t.leaveLeftAfter(days(q.left - q.days)),
                ]
                  .filter(Boolean)
                  .join(' · ')
            : (errorOf(quote.error) ?? ' ')}
        </Text>
        <Button
          label={t.askLeave}
          disabled={
            !datesOk || !type || reason.trim().length < 1 || q?.days === 0 || send.isPending
          }
          onPress={() => send.mutate()}
        />
      </Card>
      {send.isSuccess && <Note tone="go">{t.staffLeaveSent}</Note>}
      {send.isError && <Note>{errorOf(send.error)}</Note>}

      {mine.data.requests.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={s.lead}>
            {t.myLeaveRequests}
          </Text>
          {mine.data.requests.map((r) => (
            <Card
              key={r.id}
              tone={r.state === 'approved' ? 'go' : r.state === 'rejected' ? 'stop' : undefined}
            >
              <Text style={s.body}>
                {r.typeCode} · {r.from === r.to ? r.from : `${r.from} – ${r.to}`}
                {r.halfDay ? ` · ${t.halfDay}` : ''} · {t.leaveCounts(days(r.days))}
              </Text>
              <Text style={s.muted}>
                {t.staffLeaveStates[r.state]}
                {r.note ? ` · ${r.note}` : ''}
              </Text>
              {(r.state === 'pending' || (r.state === 'approved' && r.from > today)) && (
                <Button
                  label={t.cancelLeave}
                  kind="secondary"
                  disabled={cancel.isPending}
                  onPress={() => cancel.mutate(r.id)}
                />
              )}
            </Card>
          ))}
          {cancel.isError && <Note>{errorOf(cancel.error)}</Note>}
        </View>
      )}
    </Screen>
  );
}
