import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../lib/app';
import { color } from '../lib/theme';
import { Loading, Screen } from '../lib/ui';
import { SignIn } from '../lib/sign-in';

const client = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });

/** Signed out, or signed in without a chosen profile: the sign-in flow. Otherwise the app. */
function Gate() {
  const { ready, session, t } = useApp();
  if (!ready) {
    return (
      <Screen>
        <Loading label={t.loading} />
      </Screen>
    );
  }
  if (!session?.profile) return <SignIn />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }} />
  );
}

export default function Root() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={client}>
        <AppProvider>
          <StatusBar style="dark" />
          <Gate />
        </AppProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
