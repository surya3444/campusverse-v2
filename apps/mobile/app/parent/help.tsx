// Help from school (docs/specs/HELPDESK.md): the parent's requests with the school's replies, a
// reply box, and asking for help about this child.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, ApiFailure } from '../../lib/api';
import { useApp } from '../../lib/app';
import { color } from '../../lib/theme';
import { Button, Card, Field, Loading, Note, Screen, s } from '../../lib/ui';
import type { Home } from '../index';

type Request = {
  ticketId: string;
  number: number;
  subject: string;
  state: string;
  category: string;
};
type Thread = Request & {
  messages: { messageId: string; author: string | null; body: string; at: string }[];
};
type Category = { id: string; name: string; audience: string; active: boolean };

export default function HelpScreen() {
  const { t } = useApp();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const qc = useQueryClient();
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<Home>('/parent/home') });
  const list = useQuery({
    queryKey: ['help-requests'],
    queryFn: () => api.get<Request[]>('/helpdesk/requests'),
  });
  const cats = useQuery({
    queryKey: ['help-categories'],
    queryFn: () => api.get<Category[]>('/helpdesk/categories'),
  });
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [subject, setSubject] = useState('');
  const [details, setDetails] = useState('');
  const [reply, setReply] = useState('');
  const thread = useQuery({
    queryKey: ['help-thread', open],
    queryFn: () => api.get<Thread>(`/helpdesk/tickets/${open}`),
    enabled: !!open,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['help-requests'] });
    void qc.invalidateQueries({ queryKey: ['help-thread'] });
  };
  const ask = useMutation({
    mutationFn: () =>
      api.post('/helpdesk/tickets', {
        studentId: childId,
        categoryId,
        subject,
        body: details,
        priority: 'normal',
      }),
    onSuccess: () => {
      setAsking(false);
      setSubject('');
      setDetails('');
      refresh();
    },
  });
  const send = useMutation({
    mutationFn: () => api.post(`/helpdesk/tickets/${open}/reply`, { body: reply, internal: false }),
    onSuccess: () => {
      setReply('');
      refresh();
    },
  });
  const child = home.data?.children.find((c) => c.personId === childId);
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() =>
        open ? setOpen(null) : router.canGoBack() ? router.back() : router.replace('/')
      }
    />
  );
  if (home.isPending || list.isPending) {
    return (
      <Screen title={t.helpTitle} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (list.isError || !child) {
    return (
      <Screen title={t.helpTitle} right={back}>
        <Note>{list.isError ? t.error : t.denied}</Note>
      </Screen>
    );
  }

  if (open) {
    const d = thread.data;
    return (
      <Screen title={d ? t.helpRequest(d.number) : t.helpTitle} right={back}>
        {!d ? (
          <Loading label={t.loading} />
        ) : (
          <>
            <Text style={s.lead}>{d.subject}</Text>
            <Text style={s.muted}>{t.helpStates[d.state] ?? d.state}</Text>
            {d.messages.map((m) => (
              <Card key={m.messageId}>
                <Text style={s.muted}>{m.author ?? ''}</Text>
                <Text style={s.body}>{m.body}</Text>
              </Card>
            ))}
            <Card>
              <Field
                label={t.helpReply}
                value={reply}
                onChangeText={setReply}
                multiline
                maxLength={4000}
              />
              <Button
                label={t.send}
                disabled={!reply.trim() || send.isPending}
                onPress={() => send.mutate()}
              />
              {send.isError && (
                <Note>
                  {send.error instanceof ApiFailure && send.error.code === 'closed'
                    ? t.helpClosed
                    : t.error}
                </Note>
              )}
            </Card>
          </>
        )}
      </Screen>
    );
  }

  const choices = (cats.data ?? []).filter((c) => c.active && c.audience !== 'staff');
  return (
    <Screen title={t.helpTitle} right={back}>
      <Text style={s.muted}>{child.name}</Text>
      {ask.isSuccess && <Note tone="go">{t.helpSent}</Note>}
      {!asking ? (
        <Button label={t.helpAsk} kind="secondary" onPress={() => setAsking(true)} />
      ) : (
        <Card>
          <Text style={s.label}>{t.helpCategory}</Text>
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {choices.map((c) => (
              <Pressable
                key={c.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: categoryId === c.id }}
                aria-checked={categoryId === c.id}
                onPress={() => setCategoryId(c.id)}
                style={{
                  minHeight: 44,
                  borderRadius: 8,
                  borderWidth: 1,
                  paddingHorizontal: 12,
                  justifyContent: 'center',
                  borderColor: categoryId === c.id ? color.navy950 : color.lineStrong,
                  backgroundColor: categoryId === c.id ? color.navy50 : color.surface,
                }}
              >
                <Text style={{ ...s.body, color: categoryId === c.id ? color.navy950 : color.ink }}>
                  {c.name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field label={t.helpSubject} value={subject} onChangeText={setSubject} maxLength={160} />
          <Field
            label={t.helpDetails}
            value={details}
            onChangeText={setDetails}
            multiline
            maxLength={4000}
          />
          <Button
            label={t.send}
            disabled={!categoryId || !subject.trim() || !details.trim() || ask.isPending}
            onPress={() => ask.mutate()}
          />
          {ask.isError && <Note>{t.error}</Note>}
        </Card>
      )}
      {list.data.length === 0 ? (
        <Card>
          <Text style={s.body}>{t.helpNone}</Text>
        </Card>
      ) : (
        list.data.map((r) => (
          <Pressable
            key={r.ticketId}
            accessibilityRole="button"
            onPress={() => setOpen(r.ticketId)}
          >
            <Card>
              <Text style={[s.body, { fontWeight: '600' }]}>
                {t.helpRequest(r.number)} · {r.subject}
              </Text>
              <Text style={s.muted}>
                {r.category} · {t.helpStates[r.state] ?? r.state}
              </Text>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
