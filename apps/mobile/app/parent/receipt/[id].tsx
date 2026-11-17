// A receipt exactly as the school issued it: never recalculated in the app.
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { api } from '../../../lib/api';
import { useApp } from '../../../lib/app';
import { Button, Card, Loading, Note, Screen, s } from '../../../lib/ui';
import { rupees } from '../../../lib/money';

type Receipt = {
  number: string;
  amountPaise: number;
  issuedAt: string;
  snapshot: {
    entity?: string;
    institution?: string;
    student?: string;
    method?: string;
    lines?: { invoice: string; amountPaise: number }[];
  };
};

export default function ReceiptScreen() {
  const { t } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const r = useQuery({
    queryKey: ['receipt', id],
    queryFn: () => api.get<Receipt>(`/finance/receipts/${id}`),
  });
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
  if (r.isPending) {
    return (
      <Screen title={t.receipt} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (r.isError) {
    return (
      <Screen title={t.receipt} right={back}>
        <Note>{t.error}</Note>
      </Screen>
    );
  }
  const x = r.data;
  return (
    <Screen title={t.receipt} right={back}>
      <Card>
        <Text style={s.muted}>{x.snapshot.entity}</Text>
        <Text style={s.lead}>{x.snapshot.institution}</Text>
        <Text style={s.body}>
          {t.receipt} {x.number} · {x.issuedAt.slice(0, 10)}
        </Text>
        <Text style={s.body}>{x.snapshot.student}</Text>
        {(x.snapshot.lines ?? []).map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[s.body, { flex: 1 }]}>{l.invoice}</Text>
            <Text style={s.body}>{rupees(l.amountPaise)}</Text>
          </View>
        ))}
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 8 }}
        >
          <Text style={s.lead}>{t.total}</Text>
          <Text style={s.lead}>{rupees(x.amountPaise)}</Text>
        </View>
      </Card>
    </Screen>
  );
}
