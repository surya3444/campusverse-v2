// A child's homework (docs/specs/HOMEWORK.md): open homework by due date with attachments and a
// Done tick, then the class diary for the last school days.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { api, ApiFailure } from '../../lib/api';
import { useApp } from '../../lib/app';
import { dayLabel } from '../../lib/lessons';
import { color } from '../../lib/theme';
import { Button, Card, Loading, Note, Screen, s } from '../../lib/ui';
import type { Home } from '../index';

type ChildHomework = {
  section: string | null;
  homework: {
    id: string;
    subject: string;
    title: string;
    details: string;
    dueOn: string;
    done: boolean;
    files: { fileId: string; fileName: string }[];
  }[];
  diary: {
    id: string;
    onDate: string;
    subject: string | null;
    body: string;
    writtenByName: string;
  }[];
};

export default function HomeworkScreen() {
  const { t } = useApp();
  const qc = useQueryClient();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<Home>('/parent/home') });
  const key = ['child-homework', childId];
  const view = useQuery({
    queryKey: key,
    queryFn: () => api.get<ChildHomework>(`/school/homework/children/${childId}`),
    enabled: !!childId,
  });
  const tick = useMutation({
    mutationFn: (h: { id: string; done: boolean }) =>
      api.post(`/school/homework/${h.id}/children/${childId}/done`, { done: h.done }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const open = useMutation({
    mutationFn: (f: { homeworkId: string; fileId: string }) =>
      api.get<{ url: string }>(
        `/school/homework/${f.homeworkId}/files/${f.fileId}/link?studentId=${childId}`,
      ),
    onSuccess: (r) => void Linking.openURL(r.url),
  });
  const child = home.data?.children.find((c) => c.personId === childId);
  const title = child ? t.homeworkTitle(child.name.split(' ')[0] ?? '') : t.homework;
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (home.isPending || view.isPending) {
    return (
      <Screen title={title} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (view.isError || !child) {
    const denied = view.error instanceof ApiFailure && view.error.status === 403;
    return (
      <Screen title={title} right={back}>
        <Note>{denied || !child ? t.denied : t.error}</Note>
        {!denied && child && (
          <Button label={t.retry} kind="secondary" onPress={() => void view.refetch()} />
        )}
      </Screen>
    );
  }
  const today = child.day.onDate;
  const days = [...new Set(view.data.diary.map((d) => d.onDate))];
  return (
    <Screen title={title} right={back}>
      {view.data.section && <Text style={s.muted}>{view.data.section}</Text>}
      {view.data.homework.length === 0 ? (
        <Card>
          <Text style={s.body}>{t.noHomework}</Text>
        </Card>
      ) : (
        view.data.homework.map((h) => (
          <Card key={h.id} {...(h.done ? { tone: 'go' as const } : {})}>
            <Text style={[s.body, { fontWeight: '600' }]}>
              {h.subject} · {h.title}
            </Text>
            <Text
              style={{
                ...s.muted,
                color: h.dueOn <= today && !h.done ? color.warnInk : color.inkMuted,
              }}
            >
              {t.dueOn(dayLabel(t, h.dueOn, today))}
              {h.done ? ` · ${t.doneTick}` : ''}
            </Text>
            {!!h.details && <Text style={s.body}>{h.details}</Text>}
            {h.files.map((f) => (
              <Pressable
                key={f.fileId}
                accessibilityRole="link"
                onPress={() => open.mutate({ homeworkId: h.id, fileId: f.fileId })}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text style={{ ...s.body, color: color.navy950, textDecorationLine: 'underline' }}>
                  {t.openFile(f.fileName)}
                </Text>
              </Pressable>
            ))}
            <Button
              label={h.done ? t.notDoneYet : t.markDone}
              kind={h.done ? 'quiet' : 'secondary'}
              disabled={tick.isPending}
              onPress={() => tick.mutate({ id: h.id, done: !h.done })}
            />
          </Card>
        ))
      )}
      {(tick.isError || open.isError) && <Note>{t.error}</Note>}

      <Text accessibilityRole="header" style={s.lead}>
        {t.classDiary}
      </Text>
      {days.length === 0 ? (
        <Card>
          <Text style={s.body}>{t.noDiary}</Text>
        </Card>
      ) : (
        days.map((d) => (
          <Card key={d}>
            <Text style={s.label}>{dayLabel(t, d, today)}</Text>
            {view.data.diary
              .filter((e) => e.onDate === d)
              .map((e) => (
                <View key={e.id} style={{ gap: 2 }}>
                  <Text style={s.body}>
                    <Text style={{ fontWeight: '600' }}>{e.subject ?? t.generalNote}: </Text>
                    {e.body}
                  </Text>
                  <Text style={s.muted}>{e.writtenByName}</Text>
                </View>
              ))}
          </Card>
        ))
      )}
    </Screen>
  );
}
