// A child's fees: what is due before paying, each bill, and every receipt.
import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Linking, Pressable, Text, View } from 'react-native';
import { api, ApiFailure } from '../../lib/api';
import { useApp } from '../../lib/app';
import { color } from '../../lib/theme';
import { rupees } from '../../lib/money';
import { Button, Card, Loading, Note, Screen, s } from '../../lib/ui';

type Account = {
  name: string;
  balancePaise: number;
  canPayOnline: boolean;
  invoices: {
    id: string;
    label: string;
    dueOn: string;
    state: string;
    totalPaise: number;
    paidPaise: number;
  }[];
  payments: {
    id: string;
    amountPaise: number;
    state: string;
    at: string;
    receiptId: string | null;
    receiptNumber: string | null;
  }[];
};

export default function FeesScreen() {
  const { t } = useApp();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const account = useQuery({
    queryKey: ['fees', childId],
    queryFn: () => api.get<Account>(`/finance/students/${childId}`),
  });
  const pay = useMutation({
    mutationFn: () => api.post<{ url: string }>(`/finance/students/${childId}/pay`),
    onSuccess: (r) => void Linking.openURL(r.url),
  });
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
  if (account.isPending) {
    return (
      <Screen title={t.fees} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (account.isError) {
    const denied =
      account.error instanceof ApiFailure &&
      (account.error.status === 403 || account.error.status === 422);
    return (
      <Screen title={t.fees} right={back}>
        <Note>{denied ? t.denied : t.error}</Note>
      </Screen>
    );
  }
  const a = account.data;
  return (
    <Screen title={t.fees} right={back}>
      <Text style={s.muted}>{a.name}</Text>
      <Card tone={a.balancePaise > 0 ? 'warn' : 'go'}>
        <Text style={s.lead}>
          {a.balancePaise > 0 ? t.dueNow(rupees(a.balancePaise)) : t.allPaid}
        </Text>
        {a.balancePaise > 0 && a.canPayOnline && (
          <>
            <Button
              label={t.payOnline(rupees(a.balancePaise))}
              disabled={pay.isPending}
              onPress={() => pay.mutate()}
            />
            <Text style={s.muted}>{t.payHint}</Text>
          </>
        )}
      </Card>
      {pay.isError && <Note>{t.error}</Note>}

      <Text accessibilityRole="header" style={s.lead}>
        {t.invoices}
      </Text>
      {a.invoices.map((i) => (
        <Card key={i.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={[s.body, { fontWeight: '600', flex: 1 }]}>{i.label}</Text>
            <Text style={s.body}>{rupees(i.totalPaise)}</Text>
          </View>
          <Text
            style={{
              ...s.muted,
              color:
                i.state === 'overdue'
                  ? color.stopInk
                  : i.state === 'paid'
                    ? color.goInk
                    : color.inkMuted,
            }}
          >
            {t.feeStates[i.state] ?? i.state} · {i.dueOn}
          </Text>
        </Card>
      ))}

      {a.payments.some((p) => p.receiptId) && (
        <Text accessibilityRole="header" style={s.lead}>
          {t.receipts}
        </Text>
      )}
      {a.payments
        .filter((p) => p.receiptId)
        .map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="link"
            onPress={() => router.push(`/parent/receipt/${p.receiptId}`)}
            style={{
              backgroundColor: color.surface,
              borderWidth: 1,
              borderColor: color.line,
              borderRadius: 12,
              padding: 14,
              flexDirection: 'row',
              gap: 8,
            }}
          >
            <Text style={[s.body, { flex: 1 }]}>
              {t.receipt} {p.receiptNumber}
            </Text>
            <Text style={[s.body, { fontWeight: '600' }]}>{rupees(p.amountPaise)}</Text>
          </Pressable>
        ))}
    </Screen>
  );
}
