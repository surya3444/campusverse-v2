// One message. Opening it records a read on the app channel; a notice may ask for acknowledgement.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { api } from '../../../lib/api';
import { useApp } from '../../../lib/app';
import { Button, Card, Loading, Note, Screen, s } from '../../../lib/ui';
import type { InboxItem } from '../../index';

export default function MessageScreen() {
  const { t } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const inbox = useQuery({
    queryKey: ['messages', null],
    queryFn: () => api.get<{ items: InboxItem[]; unread: number }>('/parent/messages'),
  });
  const m = inbox.data?.items.find((i) => i.id === id);
  const read = useMutation({
    mutationFn: () => api.post(`/parent/messages/${id}/read`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['messages'] }),
  });
  const ack = useMutation({
    mutationFn: () => api.post(`/parent/messages/${id}/acknowledge`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['messages'] }),
  });
  const unread = !!m && !m.readAt;
  const { mutate: markRead } = read;
  useEffect(() => {
    if (unread) markRead();
  }, [unread, markRead]);

  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
  if (inbox.isPending) {
    return (
      <Screen right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (!m) {
    return (
      <Screen right={back}>
        <Note>{inbox.isError ? t.error : t.denied}</Note>
      </Screen>
    );
  }
  return (
    <Screen right={back}>
      <Card>
        <Text accessibilityRole="header" style={s.lead}>
          {m.title}
        </Text>
        <Text style={s.body}>{m.body}</Text>
        <Text style={s.muted}>{new Date(m.createdAt).toLocaleString()}</Text>
      </Card>
      {m.needsAck &&
        (m.acknowledgedAt ? (
          <Note tone="go">{t.acknowledged}</Note>
        ) : (
          <>
            <Text style={s.muted}>{t.ackNeeded}</Text>
            <Button label={t.acknowledge} disabled={ack.isPending} onPress={() => ack.mutate()} />
          </>
        ))}
      {ack.isError && <Note>{t.error}</Note>}
    </Screen>
  );
}
