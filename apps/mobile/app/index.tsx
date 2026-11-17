// Home: for a parent, each child's day in one sentence, then the next action, then messages.
// For a class teacher, today's sections to mark; for a teacher, today's lessons (covers too).
// A person who is both sees both.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, router } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { api, ApiFailure } from '../lib/api';
import { useApp } from '../lib/app';
import { busLine, mapUrl, type ChildBus } from '../lib/bus';
import { myLessons, type DayLesson } from '../lib/lessons';
import { days as leaveDays, type LeaveType, type MyLeave } from '../lib/leave';
import type { Messages } from '../lib/messages';
import { color } from '../lib/theme';
import { Button, Card, Loading, Note, Screen, s } from '../lib/ui';

export type Child = {
  personId: string;
  name: string;
  placement: string | null;
  day: {
    onDate: string;
    status: string | null;
    holiday: string | null;
    onLeave: 'leave' | 'medical' | null;
    leave: { id: string; kind: string; from: string; to: string; reason: string; status: string }[];
  };
  /** One per direction the child rides today; empty without transport. */
  bus: ChildBus[];
};
export type Home = { language: string; unread: number; children: Child[] };
export type InboxItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  state: string;
  aboutPersonId: string | null;
  needsAck: boolean;
  readAt: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
};
type SectionDay = {
  sectionId: string;
  label: string;
  mine: boolean;
  state: string;
  students: number;
  absent: number;
};

/** Parents without a role elsewhere get 403 on staff calls, and staff on parent calls: not an error. */
const orNull = <T,>(p: Promise<T>) =>
  p.catch((e) => (e instanceof ApiFailure && e.status === 403 ? null : Promise.reject(e)));

export function statusSentence(
  t: Messages,
  c: Child,
): { text: string; tone: 'go' | 'warn' | 'stop' | undefined } {
  const first = c.name.split(' ')[0] ?? c.name;
  if (c.day.holiday) return { text: t.statusHoliday(c.day.holiday), tone: undefined };
  switch (
    c.day.status ??
    (c.day.onLeave === 'medical' ? 'medical_leave' : c.day.onLeave ? 'approved_leave' : null)
  ) {
    case 'present':
      return { text: t.statusPresent(first), tone: 'go' };
    case 'absent':
      return { text: t.statusAbsent(first), tone: 'stop' };
    case 'late':
      return { text: t.statusLate(first), tone: 'warn' };
    case 'half_day':
      return { text: t.statusHalfDay(first), tone: 'warn' };
    case 'approved_leave':
      return { text: t.statusLeave(first), tone: undefined };
    case 'medical_leave':
      return { text: t.statusMedical(first), tone: undefined };
    case 'school_duty':
      return { text: t.statusDuty(first), tone: 'go' };
    default:
      return { text: t.statusNotYet(first), tone: undefined };
  }
}

export default function HomeScreen() {
  const { t, pending, session } = useApp();
  const me = session?.profile?.personId ?? '';
  const [childId, setChildId] = useState<string | null>(null);
  const home = useQuery({
    queryKey: ['home'],
    queryFn: () => orNull(api.get<Home>('/parent/home')),
    // While a child's bus runs, keep its sentence and position fresh.
    refetchInterval: (q) =>
      q.state.data?.children.some((c) => c.bus.some((b) => b.trip?.running)) ? 30_000 : false,
  });
  const messages = useQuery({
    queryKey: ['messages', childId],
    queryFn: () =>
      orNull(
        api.get<{ items: InboxItem[]; unread: number }>(
          `/parent/messages${childId ? `?childId=${childId}` : ''}`,
        ),
      ),
    enabled: !!home.data?.children.length,
  });
  const sections = useQuery({
    queryKey: ['teacher-sections'],
    queryFn: async () => {
      const schools = await orNull(api.get<{ id: string }[]>('/school/setup/institutions'));
      const id = schools?.[0]?.id;
      if (!id) return null;
      const day = await orNull(api.get<{ sections: SectionDay[] }>(`/school/attendance/${id}/day`));
      return day?.sections.filter((x) => x.mine) ?? null;
    },
  });
  const lessons = useQuery({
    queryKey: ['teacher-lessons', me],
    queryFn: async () => {
      const schools = await orNull(api.get<{ id: string }[]>('/school/setup/institutions'));
      const id = schools?.[0]?.id;
      if (!id) return null;
      const day = await orNull(
        api.get<{ holiday: string | null; lessons: DayLesson[] }>(
          `/school/timetable/day?institutionId=${id}`,
        ),
      );
      return day ? myLessons(day.lessons, me) : null;
    },
  });

  // Teachers: the classes they can set homework for (parents get 403, so nothing shows).
  const homeworkClasses = useQuery({
    queryKey: ['homework-home'],
    queryFn: async () => {
      const schools = await orNull(api.get<{ id: string }[]>('/school/setup/institutions'));
      const id = schools?.[0]?.id;
      if (!id) return 0;
      const r = await orNull(
        api.get<{ classes: unknown[] }>(`/school/homework/classes?institutionId=${id}`),
      );
      return r?.classes.length ?? 0;
    },
  });

  // Staff: what's left of their leave (parents get 403, so nothing shows).
  const leave = useQuery({
    queryKey: ['staff-leave-home'],
    queryFn: async () => {
      const schools = await orNull(api.get<{ id: string }[]>('/school/setup/institutions'));
      const id = schools?.[0]?.id;
      if (!id) return null;
      const [mine, types] = await Promise.all([
        orNull(api.get<MyLeave>(`/staff-leave/me?institutionId=${id}`)),
        orNull(api.get<LeaveType[]>(`/staff-leave/types?institutionId=${id}`)),
      ]);
      if (!mine || !types) return null;
      const name = new Map(types.filter((x) => x.active).map((x) => [x.id, x.code]));
      return mine.balances
        .filter((b) => name.has(b.typeId) && b.left !== null)
        .map((b) => ({ code: name.get(b.typeId) ?? '', left: leaveDays(b.left ?? 0) }));
    },
  });

  const settings = (
    <Link href="/settings" asChild>
      <Pressable accessibilityRole="button" hitSlop={8}>
        <Text style={{ ...s.body, color: color.navy950 }}>{t.settings}</Text>
      </Pressable>
    </Link>
  );

  if (home.isPending || sections.isPending || lessons.isPending) {
    return (
      <Screen title={t.appName} right={settings}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (home.isError || sections.isError || lessons.isError) {
    return (
      <Screen title={t.appName} right={settings}>
        <Note>{t.error}</Note>
        <Button
          label={t.retry}
          kind="secondary"
          onPress={() => void Promise.all([home.refetch(), sections.refetch(), lessons.refetch()])}
        />
      </Screen>
    );
  }
  const children = home.data?.children ?? [];
  const shown = childId ? children.filter((c) => c.personId === childId) : children;
  const isParent = !!home.data;
  const mySections = sections.data ?? [];
  const myDay = lessons.data ?? [];

  return (
    <Screen title={t.appName} right={settings}>
      {pending > 0 && <Note tone="warn">{t.pending(pending)}</Note>}

      {mySections.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={s.lead}>
            {t.sectionsToday}
          </Text>
          {mySections.map((sec) => (
            <Pressable
              key={sec.sectionId}
              accessibilityRole="button"
              accessibilityLabel={`${t.markAttendance}: ${sec.label}`}
              onPress={() => router.push(`/teacher/${sec.sectionId}`)}
              style={{
                backgroundColor: color.surface,
                borderWidth: 1,
                borderColor: color.line,
                borderRadius: 12,
                padding: 16,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <Text style={[s.lead, { flex: 1 }]}>{sec.label}</Text>
              <Text
                style={{
                  ...s.muted,
                  color: sec.state === 'not_taken' ? color.warnInk : color.goInk,
                }}
              >
                {sec.state === 'not_taken' ? t.notMarked : t.marked}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {myDay.length > 0 && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={s.lead}>
            {t.lessonsToday}
          </Text>
          <Card>
            {myDay.map((l, i) => (
              <View
                key={l.slotId}
                style={{
                  flexDirection: 'row',
                  gap: 12,
                  paddingTop: i ? 10 : 0,
                  borderTopWidth: i ? 1 : 0,
                  borderTopColor: color.line,
                }}
              >
                <Text style={[s.muted, { width: 64, fontVariant: ['tabular-nums'] }]}>
                  {l.startsAt}
                </Text>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[s.body, { fontWeight: '600' }]}>
                    {l.section} · {l.subject}
                  </Text>
                  <Text style={s.muted}>
                    {[l.ordinal ? t.period(l.ordinal) : null, l.room, l.cover ? t.coverTag : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        </View>
      )}

      {!!homeworkClasses.data && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={s.lead}>
            {t.homework}
          </Text>
          <Card>
            <Button
              label={t.setHomework}
              kind="secondary"
              onPress={() => router.push('/staff/homework')}
            />
          </Card>
        </View>
      )}

      {leave.data && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={s.lead}>
            {t.myLeave}
          </Text>
          <Card>
            <Text style={[s.body, { fontVariant: ['tabular-nums'] }]}>
              {leave.data.map((b) => t.leaveLeft(b.code, b.left)).join(' · ')}
            </Text>
            <Button
              label={t.askLeave}
              kind="secondary"
              onPress={() => router.push('/staff/leave')}
            />
          </Card>
        </View>
      )}

      {isParent && children.length === 0 && (
        <Card>
          <Text style={s.body}>{t.noChildren}</Text>
        </Card>
      )}

      {children.length > 1 && (
        <View
          accessibilityRole="tablist"
          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
        >
          {[{ personId: null as string | null, name: t.allChildren }, ...children].map((c) => {
            const on = childId === c.personId;
            return (
              <Pressable
                key={c.personId ?? 'all'}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setChildId(c.personId)}
                style={{
                  paddingHorizontal: 14,
                  minHeight: 40,
                  justifyContent: 'center',
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: on ? color.navy950 : color.lineStrong,
                  backgroundColor: on ? color.navy50 : color.surface,
                }}
              >
                <Text style={{ ...s.body, color: on ? color.navy950 : color.ink }}>
                  {c.name.split(' ')[0]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {shown.map((c) => {
        const line = statusSentence(t, c);
        return (
          <Card key={c.personId} {...(line.tone ? { tone: line.tone } : {})}>
            <Text style={s.muted}>
              {c.name}
              {c.placement ? ` · ${c.placement}` : ''}
            </Text>
            <Text style={s.lead}>{line.text}</Text>
            <Bus child={c} t={t} />
            <Button
              label={t.homework}
              kind="secondary"
              onPress={() => router.push(`/parent/homework?childId=${c.personId}`)}
            />
            <Button
              label={t.library}
              kind="secondary"
              onPress={() => router.push(`/parent/library?childId=${c.personId}`)}
            />
            <Button
              label={t.hostel}
              kind="secondary"
              onPress={() => router.push(`/parent/hostel?childId=${c.personId}`)}
            />
            <Button
              label={t.help}
              kind="secondary"
              onPress={() => router.push(`/parent/help?childId=${c.personId}`)}
            />
            <Button
              label={t.timetable}
              kind="secondary"
              onPress={() => router.push(`/parent/timetable?childId=${c.personId}`)}
            />
            <Button
              label={t.fees}
              kind="secondary"
              onPress={() => router.push(`/parent/fees?childId=${c.personId}`)}
            />
            <Button
              label={t.applyLeave}
              kind="secondary"
              onPress={() => router.push(`/parent/leave?childId=${c.personId}`)}
            />
            <Button
              label={t.consent}
              kind="secondary"
              onPress={() => router.push(`/parent/consent?childId=${c.personId}`)}
            />
          </Card>
        );
      })}

      {isParent && children.length > 0 && (
        <View style={{ gap: 8 }}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'baseline',
            }}
          >
            <Text accessibilityRole="header" style={s.lead}>
              {t.messages}
            </Text>
            {!!messages.data?.unread && (
              <Text style={s.muted}>{t.unread(messages.data.unread)}</Text>
            )}
          </View>
          {messages.isPending ? (
            <Loading label={t.loading} />
          ) : !messages.data || messages.data.items.length === 0 ? (
            <Card>
              <Text style={s.muted}>{t.noMessages}</Text>
            </Card>
          ) : (
            messages.data.items.map((m) => (
              <Pressable
                key={m.id}
                accessibilityRole="link"
                onPress={() => router.push(`/parent/message/${m.id}`)}
                style={{
                  backgroundColor: color.surface,
                  borderWidth: 1,
                  borderColor: m.readAt ? color.line : color.navy950,
                  borderRadius: 12,
                  padding: 14,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  {!m.readAt && (
                    <Text style={{ ...s.muted, color: color.navy950, fontWeight: '700' }}>
                      {t.newLabel}
                    </Text>
                  )}
                  <Text style={[s.body, { fontWeight: '600', flex: 1 }]} numberOfLines={1}>
                    {m.title}
                  </Text>
                </View>
                <Text style={s.muted} numberOfLines={2}>
                  {m.body}
                </Text>
                {m.needsAck && (
                  <Text
                    style={{ ...s.muted, color: m.acknowledgedAt ? color.goInk : color.warnInk }}
                  >
                    {m.acknowledgedAt ? t.acknowledged : t.ackNeeded}
                  </Text>
                )}
              </Pressable>
            ))
          )}
        </View>
      )}

      {!isParent && mySections.length === 0 && myDay.length === 0 && (
        <Card>
          <Text style={s.body}>{t.noSections}</Text>
        </Card>
      )}
    </Screen>
  );
}

/** The child's bus today: a sentence per direction, the map while it runs, "not today". */
function Bus({ child, t }: { child: Child; t: Messages }) {
  const qc = useQueryClient();
  const first = child.name.split(' ')[0] ?? child.name;
  const today = child.day.onDate;
  const skip = useMutation({
    mutationFn: (cancel: boolean) =>
      api.post(`/parent/children/${child.personId}/bus-skip`, { date: today, cancel }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['home'] }),
  });
  if (child.bus.length === 0) return null;
  const skipping = child.bus.some((b) => b.skipping);
  const anyStarted = child.bus.some((b) => b.trip);
  return (
    <View style={{ gap: 8, borderTopWidth: 1, borderTopColor: color.line, paddingTop: 10 }}>
      <Text style={s.muted}>{t.busTitle}</Text>
      {child.bus.map((b) => {
        const line = busLine(t, first, b);
        if (!line) return null;
        return (
          <View key={b.direction} style={{ gap: 4 }}>
            <Text
              style={{
                ...s.body,
                color:
                  line.tone === 'stop'
                    ? color.stopInk
                    : line.tone === 'warn'
                      ? color.warnInk
                      : color.ink,
              }}
            >
              {line.text}
            </Text>
            {line.extra && <Text style={s.muted}>{line.extra}</Text>}
            {b.bus && (
              <>
                <Text style={s.muted}>{t.busSeen(b.bus.at)}</Text>
                <Button
                  label={t.openMap}
                  kind="secondary"
                  onPress={() => b.bus && void Linking.openURL(mapUrl(b.bus))}
                />
              </>
            )}
          </View>
        );
      })}
      {(skipping || !anyStarted) && (
        <Button
          label={skipping ? t.skipUndo : t.skipToday}
          kind="quiet"
          onPress={() => skip.mutate(skipping)}
        />
      )}
      {skip.isError && <Note>{t.error}</Note>}
    </View>
  );
}
