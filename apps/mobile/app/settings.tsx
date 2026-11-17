// Language, profile switch and sign out. Sign-out waits while attendance is still unsent.
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, session } from '../lib/api';
import { queue, useApp } from '../lib/app';
import { LANGUAGES, MESSAGES, type Language } from '../lib/messages';
import { color } from '../lib/theme';
import { Button, Card, Note, Screen, s } from '../lib/ui';

export default function SettingsScreen() {
  const { t, language, setLanguage, pending } = useApp();
  const [blocked, setBlocked] = useState(false);
  const back = (
    <Button
      label={t.back}
      kind="quiet"
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );

  const choose = async (l: Language) => {
    await setLanguage(l);
    // The school writes notices in this language when it can; staff without an inbox just keep it locally.
    await api.put('/parent/language', { language: l }).catch(() => undefined);
  };
  const signOut = async () => {
    if ((await queue.pending()).length > 0) {
      setBlocked(true);
      return;
    }
    await api.post('/auth/logout').catch(() => undefined);
    await session.save(null);
  };
  const switchProfile = async () => {
    const current = session.get();
    if (current) await session.save({ ...current, profile: null });
  };

  return (
    <Screen title={t.settings} right={back}>
      <Card>
        <Text style={s.label}>{t.language}</Text>
        <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
          {LANGUAGES.map((l) => (
            <Pressable
              key={l}
              accessibilityRole="radio"
              accessibilityState={{ checked: language === l }}
              onPress={() => void choose(l)}
              style={{
                minHeight: 48,
                paddingHorizontal: 14,
                justifyContent: 'center',
                borderRadius: 8,
                borderWidth: 1,
                borderColor: language === l ? color.navy950 : color.line,
                backgroundColor: language === l ? color.navy50 : color.surface,
              }}
            >
              <Text style={{ ...s.body, color: language === l ? color.navy950 : color.ink }}>
                {MESSAGES[l].languageName}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>
      <Button label={t.switchProfile} kind="secondary" onPress={() => void switchProfile()} />
      <Button label={t.signOut} kind="secondary" onPress={() => void signOut()} />
      {blocked && <Note tone="warn">{t.unsentSignOut(pending)}</Note>}
    </Screen>
  );
}
