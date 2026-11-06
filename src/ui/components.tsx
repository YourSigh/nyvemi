import { designTokens } from '../theme/design-tokens';
import { KeyboardAwareScrollView, KeyboardToolbar } from 'react-native-keyboard-controller';
import { NavigationContext } from '@react-navigation/native';
import { HeaderShownContext } from '@react-navigation/elements';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { usePalette, useTheme } from '../theme/context';
import type { Palette } from '../theme/model';
export function Page({ children }: PropsWithChildren) {
  const { palette, transitioning } = useTheme();
  const navigation = useContext(NavigationContext);
  const headerShown = useContext(HeaderShownContext);
  const insets = useSafeAreaInsets();
  const [viewport, setViewport] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const focus = navigation.addListener('focus', () => setFocused(true));
    const blur = navigation.addListener('blur', () => {
      setFocused(false);
      Keyboard.dismiss();
    });
    return () => {
      focus();
      blur();
    };
  }, [navigation]);
  const styles = useMemo(() => createStyles(palette), [palette]);
  const keyboardColors = {
    primary: palette.accent,
    disabled: palette.muted,
    background: palette.paper,
    ripple: palette.tint,
  };
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <KeyboardAwareScrollView
        style={{ flex: 1 }}
        enabled={focused && !transitioning}
        bottomOffset={64}
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
        onContentSizeChange={(_width, height) => setContentHeight(height)}
        scrollEnabled={
          focused &&
          !transitioning &&
          (keyboardVisible || !viewport || !contentHeight || contentHeight > viewport + 2)
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={[
          styles.page,
          {
            paddingTop: 16 + (headerShown ? 0 : insets.top),
            paddingBottom: 16 + insets.bottom,
            paddingLeft: 16 + insets.left,
            paddingRight: 16 + insets.right,
          },
        ]}
      >
        {children}
      </KeyboardAwareScrollView>
      {focused && !transitioning ? (
        <KeyboardToolbar theme={{ light: keyboardColors, dark: keyboardColors }} insets={insets}>
          <KeyboardToolbar.Prev />
          <KeyboardToolbar.Next />
          <KeyboardToolbar.Done text="收起" />
        </KeyboardToolbar>
      ) : null}
    </View>
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
  const { palette, transitioning } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  const tokens = designTokens(palette);
  const inactive = disabled || transitioning;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || transitioning}
      accessibilityState={{ disabled: disabled || transitioning }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondary,
        inactive
          ? { backgroundColor: tokens.disabled.background }
          : pressed
            ? {
                backgroundColor: secondary
                  ? tokens.interaction.secondaryPressed
                  : tokens.interaction.pressed,
              }
            : undefined,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          secondary && { color: palette.accent },
          inactive && { color: tokens.disabled.text },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
/** Secondary actions keep a full touch target without looking like another primary step. */
export function TextButton({
  title,
  onPress,
  disabled = false,
}: {
  title: string;
  onPress(): void;
  disabled?: boolean;
}) {
  const { palette, transitioning } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled || transitioning}
      accessibilityState={{ disabled: disabled || transitioning }}
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: 8,
        paddingVertical: 10,
        justifyContent: 'center',
        alignItems: 'center',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text
        style={{
          color: palette.accent,
          fontSize: 14,
          textAlign: 'center',
          includeFontPadding: false,
        }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
/** Advanced forms are absent until requested, including their keyboard focus targets. */
export function Details({
  title,
  children,
  onOpenChange,
}: PropsWithChildren<{ title: string; onOpenChange?(open: boolean): void }>) {
  const [open, setOpen] = useState(false);
  const { palette, transitioning } = useTheme();
  return (
    <View style={{ gap: open ? 8 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open, disabled: transitioning }}
        disabled={transitioning}
        onPress={() => {
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        }}
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <Text style={{ color: palette.accent, fontSize: 14, flex: 1 }}>{title}</Text>
        <Text style={{ color: palette.muted }}>{open ? '收起 −' : '展开 ＋'}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
}
export function Field({
  label,
  style,
  multiline = false,
  ...props
}: TextInputProps & { label: string }) {
  const { palette, transitioning } = useTheme();
  const styles = useMemo(() => createStyles(palette), [palette]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        placeholderTextColor={palette.muted}
        selectionColor={palette.accent}
        cursorColor={palette.accent}
        multiline={multiline}
        editable={!transitioning && props.editable !== false}
        returnKeyType={props.returnKeyType ?? (multiline ? 'default' : 'done')}
        submitBehavior={props.submitBehavior ?? (multiline ? 'newline' : 'blurAndSubmit')}
        autoCorrect={
          props.autoCorrect ?? (!props.secureTextEntry && props.autoCapitalize !== 'none')
        }
        style={[styles.input, multiline && { minHeight: 80, textAlignVertical: 'top' }, style]}
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
      padding: 16,
      gap: 12,
      paddingBottom: 16,
      backgroundColor: palette.background,
      flexGrow: 1,
    },
    heading: { fontSize: 24, fontWeight: '700', color: palette.ink },
    note: { fontSize: 14, lineHeight: 21, color: palette.muted },
    card: {
      padding: 14,
      gap: 8,
      backgroundColor: palette.paper,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: palette.line,
    },
    button: {
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderRadius: 14,
      backgroundColor: palette.action ?? palette.accent,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 48,
    },
    secondary: { backgroundColor: palette.tint },
    buttonText: {
      color: palette.onAction ?? palette.onAccent,
      fontSize: 15,
      fontWeight: '600',
      includeFontPadding: false,
      textAlign: 'center',
      textAlignVertical: 'center',
      flexShrink: 1,
    },
    field: { gap: 8 },
    label: { fontSize: 14, color: palette.ink, fontWeight: '500' },
    input: {
      backgroundColor: palette.paper,
      borderWidth: 1,
      borderColor: palette.line,
      borderRadius: 12,
      minHeight: 48,
      paddingHorizontal: 13,
      paddingVertical: 12,
      includeFontPadding: false,
      textAlignVertical: 'center',
      fontSize: 16,
      color: palette.ink,
    },
    error: { color: palette.error, lineHeight: 22 },
    busy: { padding: 24, gap: 12, alignItems: 'center' },
  });
