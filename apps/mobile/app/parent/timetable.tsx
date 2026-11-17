// The child's timetable: today and the coming school days, with who teaches each lesson, and
// a covered lesson said as such. Holidays say so.
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { api, ApiFailure } from '../../lib/api';
import { useApp } from '../../lib/app';
import { dayLabel, type ChildLesson, type ChildWeek } from '../../lib/lessons';
import type { Messages } from '../../lib/messages';
import { color } from '../../lib/theme';
import { Button, Card, Loading, Note, Screen, s } from '../../lib/ui';
import type { Home } from '../index';

export default function TimetableScreen() {
  const { t } = useApp();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<Home>('/parent/home') });
  const week = useQuery({
    queryKey: ['child-timetable', childId],
    queryFn: () => api.get<ChildWeek>(`/parent/children/${childId}/timetable`),
    enabled: !!childId,
  });
  const child = home.data?.children.find((c) => c.personId === childId);
  const first = child?.name.split(' ')[0] ?? '';
  const title = child ? t.timetableTitle(first) : t.timetable;
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (home.isPending || week.isPending) {
    return (
      <Screen title={title} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (week.isError || !child) {
    const denied = week.error instanceof ApiFailure && week.error.status === 403;
    return (
      <Screen title={title} right={back}>
        <Note>{denied || !child ? t.denied : t.error}</Note>
        {!denied && child && (
          <Button label={t.retry} kind="secondary" onPress={() => void week.refetch()} />
        )}
      </Screen>
    );
  }
  const today = child.day.onDate;
  return (
    <Screen title={title} right={back}>
      {week.data.section && <Text style={s.muted}>{week.data.section}</Text>}
      {week.data.days.length === 0 ? (
        <Card>
          <Text style={s.body}>{t.noTimetable}</Text>
        </Card>
      ) : (
        week.data.days.map((d) => (
          <View key={d.date} style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={s.lead}>
              {dayLabel(t, d.date, today)}
            </Text>
            <Card>
              {d.exams.map((e, i) => (
                <View key={`exam-${i}`} style={{ flexDirection: 'row', gap: 12 }}>
                  <Text style={[s.muted, { width: 64, fontVariant: ['tabular-nums'] }]}>
                    {e.startsAt ?? ''}
                  </Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[s.body, { fontWeight: '600', color: color.warnInk }]}>
                      {t.examLine(e.subject)}
                    </Text>
                    <Text style={s.muted}>
                      {[e.exam, e.startsAt && e.endsAt ? `${e.startsAt}–${e.endsAt}` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                </View>
              ))}
              {d.holiday ? (
                <Text style={s.body}>{t.holidayDay(d.holiday)}</Text>
              ) : (
                d.lessons.map((l, i) => (
                  <Lesson key={`${d.date}-${i}`} l={l} first={i === 0} t={t} />
                ))
              )}
            </Card>
          </View>
        ))
      )}
    </Screen>
  );
}

function Lesson({ l, first, t }: { l: ChildLesson; first: boolean; t: Messages }) {
  const who =
    l.cover === 'combined'
      ? t.combinedClass
      : l.cover === 'supervised'
        ? t.supervisedClass
        : [l.teacher, l.cover ? t.coverTag : null].filter(Boolean).join(' · ');
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: 12,
        paddingTop: first ? 0 : 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: color.line,
      }}
    >
      <Text style={[s.muted, { width: 64, fontVariant: ['tabular-nums'] }]}>{l.startsAt}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[s.body, { fontWeight: '600' }]}>{l.subject}</Text>
        <Text style={s.muted}>
          {[l.ordinal ? t.period(l.ordinal) : null, who || null, l.room]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </View>
  );
}
