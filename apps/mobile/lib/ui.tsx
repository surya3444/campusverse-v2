// The few building blocks every screen uses, in the design tokens: large targets, calm surfaces.
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { color, radius, text } from './theme';

export function Screen({
  children,
  title,
  right,
}: {
  children: ReactNode;
  title?: string;
  right?: ReactNode;
}) {
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {(title || right) && (
          <View style={s.header}>
            {title ? (
              <Text accessibilityRole="header" style={s.title}>
                {title}
              </Text>
            ) : (
              <View />
            )}
            {right}
          </View>
        )}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, tone }: { children: ReactNode; tone?: 'go' | 'warn' | 'stop' }) {
  return (
    <View
      style={[
        s.card,
        tone === 'go' && { backgroundColor: color.goTint, borderColor: color.goTint },
        tone === 'warn' && { backgroundColor: color.warnTint, borderColor: color.warn },
        tone === 'stop' && { backgroundColor: color.stopTint, borderColor: color.stopTint },
      ]}
    >
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'quiet';
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        kind === 'primary' && { backgroundColor: pressed ? color.navy900 : color.navy950 },
        kind === 'secondary' && {
          backgroundColor: color.surface,
          borderWidth: 1,
          borderColor: color.lineStrong,
        },
        kind === 'quiet' && { backgroundColor: 'transparent' },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[s.buttonText, kind !== 'primary' && { color: color.navy950 }]}>{label}</Text>
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={color.inkFaint}
        style={s.input}
        {...input}
      />
      {hint ? <Text style={s.muted}>{hint}</Text> : null}
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} style={s.center}>
      <ActivityIndicator color={color.navy950} />
      <Text style={s.muted}>{label}</Text>
    </View>
  );
}

export function Note({
  children,
  tone = 'stop',
}: {
  children: ReactNode;
  tone?: 'stop' | 'warn' | 'go';
}) {
  const bg = { stop: color.stopTint, warn: color.warnTint, go: color.goTint }[tone];
  const fg = { stop: color.stopInk, warn: color.warnInk, go: color.goInk }[tone];
  return (
    <Text accessibilityRole="alert" style={[s.note, { backgroundColor: bg, color: fg }]}>
      {children}
    </Text>
  );
}

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.paper },
  content: { padding: 16, gap: 14, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { ...text.title, color: color.ink },
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.lg,
    padding: 16,
    gap: 8,
  },
  button: {
    minHeight: 48,
    paddingHorizontal: 18,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { ...text.body, color: color.white, fontWeight: '600' },
  label: { ...text.caption, color: color.ink, fontWeight: '600' },
  input: {
    ...text.body,
    minHeight: 48,
    borderWidth: 1,
    borderColor: color.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    backgroundColor: color.surface,
    color: color.ink,
  },
  body: { ...text.body, color: color.ink },
  lead: { ...text.lead, color: color.ink, fontWeight: '600' },
  muted: { ...text.caption, color: color.inkMuted },
  center: { padding: 32, alignItems: 'center', gap: 8 },
  note: { ...text.body, padding: 12, borderRadius: radius.md, overflow: 'hidden' },
});
