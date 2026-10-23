import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { usePalette } from '../theme/context';
import type { Palette } from '../theme/model';
export function Page({ children }: PropsWithChildren) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.page}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}
export function Heading({ children }: PropsWithChildren) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return <Text style={styles.heading}>{children}</Text>;
}
export function Note({ children }: PropsWithChildren) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return <Text style={styles.note}>{children}</Text>;
}
export function Card({ children }: PropsWithChildren) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return <View style={styles.card}>{children}</View>;
}
export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.secondary, disabled && { opacity: 0.45 }]}
    >
      <Text style={[styles.buttonText, secondary && { color: palette.accent }]}>{title}</Text>
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={palette.muted}
        style={[styles.input, props.multiline && { minHeight: 72, textAlignVertical: 'top' }]}
        {...props}
      />
    </View>
  );
}
export function ErrorText({ text }: { text: string }) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return text ? (
    <Text accessibilityRole="alert" style={styles.error}>
      {text}
    </Text>
  ) : null;
}
export function Busy({ label = '正在准备…' }: { label?: string }) {
  const palette = usePalette();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.busy}>
      <ActivityIndicator color={palette.accent} />
      <Note>{label}</Note>
    </View>
  );
}
export function Avatar({ name, uri, size = 42 }: { name: string; uri?: string; size?: number }) {
  const palette = usePalette();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [uri]);
  return uri && !failed ? (
    <Image
      onError={() => setFailed(true)}
      accessibilityLabel={`${name}的头像`}
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size * 0.36 }}
    />
  ) : (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.36,
        backgroundColor: palette.tint,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.42, color: palette.accent, fontWeight: '600' }}>
        {name.slice(0, 1) || 'N'}
      </Text>
    </View>
  );
}
const createStyles = (palette: Palette) =>
  StyleSheet.create({
    page: {
      padding: 22,
      gap: 16,
      paddingBottom: 48,
      backgroundColor: palette.background,
      flexGrow: 1,
    },
    heading: { fontSize: 27, fontWeight: '700', color: palette.ink, marginTop: 12 },
    note: { fontSize: 14, lineHeight: 23, color: palette.muted },
    card: {
      padding: 18,
      gap: 12,
      backgroundColor: palette.paper,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: palette.line,
    },
    button: {
      paddingVertical: 15,
      paddingHorizontal: 18,
      borderRadius: 14,
      backgroundColor: palette.accent,
      alignItems: 'center',
      minHeight: 48,
    },
    secondary: { backgroundColor: palette.tint },
    buttonText: { color: palette.onAccent, fontSize: 15, fontWeight: '600' },
    field: { gap: 8 },
    label: { fontSize: 14, color: palette.ink, fontWeight: '500' },
    input: {
      backgroundColor: palette.paper,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 12,
      padding: 13,
      fontSize: 16,
      color: palette.ink,
    },
    error: { color: palette.error, lineHeight: 22 },
    busy: { padding: 24, gap: 12, alignItems: 'center' },
  });
