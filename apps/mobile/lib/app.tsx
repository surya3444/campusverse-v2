// App-wide state: the session, the chosen language, and the offline queue.
import * as Crypto from 'expo-crypto';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, I18nManager, Platform } from 'react-native';
import { api, session as sessionStore, type Session } from './api';
import { LANGUAGES, MESSAGES, RTL, type Language, type Messages } from './messages';
import { createQueue, uuidv7, type QueuedEvent, type SyncAnswer } from './queue';
import { queueStore } from './queue-store';
import { store } from './store';

export const queue = createQueue(queueStore, async (events) => {
  const { results } = await api.post<{ results: SyncAnswer[] }>('/sync/events', { events });
  return results;
});

export const newEventId = () => uuidv7((n) => Crypto.getRandomBytes(n));

export async function deviceId(): Promise<string> {
  const known = await store.get('cv_device_id');
  if (known) return known;
  const id = newEventId();
  await store.set('cv_device_id', id);
  return id;
}

type AppContext = {
  ready: boolean;
  session: Session | null;
  language: Language;
  t: Messages;
  setLanguage: (l: Language) => Promise<void>;
  pending: number;
  enqueue: (e: QueuedEvent) => Promise<SyncAnswer | null>;
};
const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside AppProvider');
  return c;
}

function applyDirection(l: Language) {
  const rtl = RTL.has(l);
  if (Platform.OS === 'web') {
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = l;
  } else {
    // ponytail: native RTL takes effect after the next app start; reload on change when Urdu ships.
    I18nManager.allowRTL(true);
    I18nManager.forceRTL(rtl);
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [language, setLang] = useState<Language>('en');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    void (async () => {
      setSession(await sessionStore.load());
      const saved = (await store.get('cv_language')) as Language | null;
      if (saved && LANGUAGES.includes(saved)) {
        setLang(saved);
        applyDirection(saved);
      }
      setReady(true);
    })();
    const offSession = sessionStore.subscribe(setSession);
    const offQueue = queue.subscribe(setPending);
    // Send queued work often: when the app comes to the front, and every 20 seconds.
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void queue.flush());
    const timer = setInterval(() => void queue.flush(), 20_000);
    const online = () => void queue.flush();
    if (Platform.OS === 'web') window.addEventListener('online', online);
    return () => {
      offSession();
      offQueue();
      sub.remove();
      clearInterval(timer);
      if (Platform.OS === 'web') window.removeEventListener('online', online);
    };
  }, []);

  const value = useMemo<AppContext>(
    () => ({
      ready,
      session,
      language,
      t: MESSAGES[language],
      pending,
      async setLanguage(l) {
        setLang(l);
        applyDirection(l);
        await store.set('cv_language', l);
      },
      async enqueue(e) {
        await queue.enqueue(e);
        return (await queue.flush()).find((a) => a.eventId === e.eventId) ?? null;
      },
    }),
    [ready, session, language, pending],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
