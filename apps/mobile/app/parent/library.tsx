// A child's library books (docs/specs/LIBRARY.md): what's on loan with the return date, late ones
// marked, and any fine owed.
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { api, ApiFailure } from '../../lib/api';
import { useApp } from '../../lib/app';
import { dayLabel } from '../../lib/lessons';
import { rupees } from '../../lib/money';
import { color } from '../../lib/theme';
import { Button, Card, Loading, Note, Screen, s } from '../../lib/ui';
import type { Home } from '../index';

type Loans = {
  open: { loanId: string; title: string; dueOn: string; daysLate: number }[];
  owedPaise: number;
};

export default function LibraryScreen() {
  const { t } = useApp();
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const home = useQuery({ queryKey: ['home'], queryFn: () => api.get<Home>('/parent/home') });
  const loans = useQuery({
    queryKey: ['child-library', childId],
    queryFn: () => api.get<Loans>(`/library/children/${childId}`),
    enabled: !!childId,
  });
  const child = home.data?.children.find((c) => c.personId === childId);
  const title = child ? t.libraryTitle(child.name.split(' ')[0] ?? '') : t.library;
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  if (home.isPending || loans.isPending) {
    return (
      <Screen title={title} right={back}>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (loans.isError || !child) {
    const denied = loans.error instanceof ApiFailure && loans.error.status === 403;
    return (
      <Screen title={title} right={back}>
        <Note>{denied || !child ? t.denied : t.error}</Note>
        {!denied && child && (
          <Button label={t.retry} kind="secondary" onPress={() => void loans.refetch()} />
        )}
      </Screen>
    );
  }
  const today = child.day.onDate;
  return (
    <Screen title={title} right={back}>
      {loans.data.owedPaise > 0 && (
        <Note tone="warn">{t.libraryOwed(rupees(loans.data.owedPaise))}</Note>
      )}
      {loans.data.open.length === 0 ? (
        <Card>
          <Text style={s.body}>{t.libraryNone}</Text>
        </Card>
      ) : (
        loans.data.open.map((l) => (
          <Card key={l.loanId} {...(l.daysLate > 0 ? { tone: 'warn' as const } : {})}>
            <Text style={[s.body, { fontWeight: '600' }]}>{l.title}</Text>
            <Text style={{ ...s.muted, color: l.daysLate > 0 ? color.warnInk : color.inkMuted }}>
              {l.daysLate > 0
                ? t.libraryLate(l.daysLate)
                : t.libraryDue(dayLabel(t, l.dueOn, today))}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}
