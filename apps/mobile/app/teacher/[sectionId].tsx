// Mark attendance: everyone present, tap absentees, submit. Stored on the phone first, then sent,
// so a dropped connection loses nothing; the server accepts each submission once.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, session } from '../../lib/api';
import { deviceId, newEventId, useApp } from '../../lib/app';
import { color } from '../../lib/theme';
import { Button, Card, Loading, Note, Screen, s } from '../../lib/ui';

type Sheet = {
  sectionId: string;
  label: string;
  onDate: string;
  holiday: string | null;
  session: { submittedAt: string } | null;
  canMark: boolean;
  students: {
    personId: string;
    name: string;
    rollNumber: number | null;
    status: string | null;
    onLeave: string | null;
  }[];
};

export default function MarkScreen() {
  const { t, enqueue, pending } = useApp();
  const { sectionId } = useLocalSearchParams<{ sectionId: string }>();
  const qc = useQueryClient();
  const sheet = useQuery({
    queryKey: ['sheet', sectionId],
    queryFn: () => api.get<Sheet>(`/school/attendance/sections/${sectionId}`),
  });
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: 'go' | 'warn' | 'stop'; text: string } | null>(
    null,
  );
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (sheet.isPending) {
    return (
      <Screen right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (sheet.isError) {
    return (
      <Screen right={back}>
        <Note>{t.error}</Note>
        <Button label={t.retry} kind="secondary" onPress={() => void sheet.refetch()} />
      </Screen>
    );
  }
  const d = sheet.data;
  const taken = !!d.session || !!outcome;

  const submit = async () => {
    const me = session.get()?.profile?.personId;
    if (!me) return;
    setBusy(true);
    const answer = await enqueue({
      eventId: newEventId(),
      deviceId: await deviceId(),
      actorId: me,
      occurredAt: new Date().toISOString(),
      type: 'attendance.mark',
      payload: {
        sectionId: d.sectionId,
        onDate: d.onDate,
        marks: [...absent].map((personId) => ({ personId, status: 'absent' })),
      },
    });
    setBusy(false);
    setOutcome(
      !answer
        ? { tone: 'warn', text: t.savedOffline }
        : answer.outcome === 'rejected'
          ? { tone: 'stop', text: t.error }
          : { tone: 'go', text: t.submitted },
    );
    if (answer) void qc.invalidateQueries({ queryKey: ['teacher-sections'] });
  };

  return (
    <Screen title={d.label} right={back}>
      <Text style={s.muted}>{d.onDate}</Text>
      {pending > 0 && <Note tone="warn">{t.pending(pending)}</Note>}
      {outcome && <Note tone={outcome.tone}>{outcome.text}</Note>}
      {d.holiday ? (
        <Card>
          <Text style={s.body}>{t.statusHoliday(d.holiday)}</Text>
        </Card>
      ) : taken ? (
        <Card tone="go">
          <Text style={s.body}>{t.submitted}</Text>
        </Card>
      ) : !d.canMark ? (
        <Note>{t.denied}</Note>
      ) : (
        <>
          <Text style={s.muted}>{t.tapHint}</Text>
          <View style={{ gap: 8 }}>
            {d.students.map((st) => {
              const on = absent.has(st.personId);
              const leave = !on && st.onLeave;
              return (
                <Pressable
                  key={st.personId}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${st.name}: ${on ? t.absent : t.present}`}
                  onPress={() =>
                    setAbsent((x) => {
                      const next = new Set(x);
                      if (on) next.delete(st.personId);
                      else next.add(st.personId);
                      return next;
                    })
                  }
                  style={{
                    minHeight: 56,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingHorizontal: 16,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: on ? color.stop : color.line,
                    backgroundColor: on ? color.stopTint : leave ? color.navy50 : color.surface,
                  }}
                >
                  <Text style={[s.muted, { width: 24 }]}>{st.rollNumber ?? ''}</Text>
                  <Text
                    style={[
                      s.body,
                      { flex: 1, fontWeight: '600', color: on ? color.stopInk : color.ink },
                    ]}
                    numberOfLines={1}
                  >
                    {st.name}
                  </Text>
                  <Text style={{ ...s.muted, color: on ? color.stopInk : color.inkMuted }}>
                    {on ? t.absent : t.present}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Button
            label={absent.size ? t.submitAbsent(absent.size) : t.submitAll}
            disabled={busy}
            onPress={() => void submit()}
          />
        </>
      )}
    </Screen>
  );
}
