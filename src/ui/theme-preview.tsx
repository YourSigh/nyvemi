import { Icon } from './icons';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useMemo, useState } from 'react';
import { Keyboard, Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { designTokens } from '../theme/design-tokens';
import { visualThemes, visualThemePalette, type VisualThemeId } from '../theme/visual-presets';
import { CocoonCharacter } from './character/cocoon';
import { StatusBar } from 'expo-status-bar';
import type { ScreenProps } from './navigation';
/** Read-only design sandbox: no model calls, saved theme writes, or onboarding progress changes. */
export function ThemePreviewScreen({ navigation, route }: ScreenProps<'ThemePreview'>) {
  const [selected, setSelected] = useState<VisualThemeId>(
    () => visualThemes.find((t) => t.id === route.params?.preset)?.id ?? 'sakura',
  );
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const { height } = useWindowDimensions();
  const palette = useMemo(() => visualThemePalette(selected), [selected]);
  const t = useMemo(() => designTokens(palette), [palette]);
  const preset = visualThemes.find((item) => item.id === selected)!;
  const stageHeight = Math.max(100, Math.min(240, (height - 390) * 0.65));
  const choice = (id: VisualThemeId) => {
    Keyboard.dismiss();
    setSelected(id);
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar style={selected === 'nebula' ? 'light' : 'dark'} />
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }} keyboardVerticalOffset={0}>
        <View style={{ flex: 1, paddingHorizontal: 18, paddingBottom: 10, gap: 10 }}>
          <View
            style={{
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="返回"
              onPress={() =>
                navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Provider')
              }
              hitSlop={8}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Icon name="arrow-left" color={t.secondaryText} />
            </Pressable>
            <Text style={{ color: t.text, fontSize: 19, letterSpacing: 1, fontWeight: '600' }}>
              主题预览
            </Text>
            <View style={{ width: 42 }} />
          </View>
          <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 6 }}>
            {visualThemes.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityLabel={item.name}
                accessibilityState={{ selected: selected === item.id }}
                onPress={() => choice(item.id)}
                style={({ pressed }) => ({
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  backgroundColor: pressed
                    ? t.recommendation.pressed
                    : selected === item.id
                      ? t.recommendation.selected
                      : t.card,
                  borderColor: selected === item.id ? t.primary : t.border,
                })}
              >
                <Text
                  style={{
                    color: selected === item.id ? t.recommendation.text : t.secondaryText,
                    fontSize: 12,
                    fontWeight: selected === item.id ? '600' : '400',
                  }}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {!focused ? (
            <View style={{ alignItems: 'center', gap: 6, paddingTop: 4 }}>
              <Text
                style={{
                  color: t.recommendation.text,
                  fontSize: 15,
                  fontWeight: '500',
                  letterSpacing: 0.4,
                }}
              >
                {preset.name}
              </Text>
              <Text style={{ color: t.secondaryText, fontSize: 11 }}>慢慢认识你 · 1/8</Text>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {Array.from({ length: 8 }, (_, n) => (
                  <View
                    key={n}
                    style={{
                      width: n === 1 ? 14 : 4,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: n < 2 ? t.primary : t.border,
                    }}
                  />
                ))}
              </View>
            </View>
          ) : null}
          <CocoonCharacter
            height={focused ? 72 : stageHeight}
            glow={t.character.glow}
            light={t.character.support}
          />
          <View
            style={{ flex: 1, minHeight: 0, justifyContent: 'flex-end', gap: 10, paddingBottom: 4 }}
          >
            <View
              style={{
                alignSelf: 'flex-end',
                maxWidth: '84%',
                paddingHorizontal: 14,
                paddingVertical: 11,
                borderRadius: t.radius.bubble,
                borderTopRightRadius: 5,
                backgroundColor: t.user.background,
              }}
            >
              <Text style={{ color: t.user.text, fontSize: 14, lineHeight: 21 }}>
                我喜欢安静一点的感觉。
              </Text>
            </View>
            <View
              style={{
                alignSelf: 'flex-start',
                maxWidth: '88%',
                paddingHorizontal: 14,
                paddingVertical: 11,
                borderRadius: t.radius.bubble,
                borderTopLeftRadius: 5,
                borderWidth: 1,
                borderColor: t.ai.border,
                backgroundColor: t.ai.background,
              }}
            >
              <Text style={{ color: t.ai.text, fontSize: 14, lineHeight: 21 }}>
                那就慢慢来，我在这里。
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
            {visualThemes
              .filter((item) => item.id !== selected)
              .map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`预览${item.name}`}
                  onPress={() => choice(item.id)}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    paddingHorizontal: 12,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: t.recommendation.border,
                    backgroundColor: pressed
                      ? t.recommendation.pressed
                      : t.recommendation.background,
                    borderRadius: t.radius.recommendation,
                  })}
                >
                  <Text
                    style={{
                      color: t.recommendation.text,
                      fontSize: 12,
                      includeFontPadding: false,
                    }}
                  >
                    {item.option}
                  </Text>
                </Pressable>
              ))}
          </View>
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              paddingTop: 8,
              alignItems: 'center',
              borderTopWidth: 1,
              borderTopColor: t.border,
            }}
          >
            <TextInput
              accessibilityLabel="预览输入框"
              placeholder="试着打几个字…"
              value={draft}
              onChangeText={setDraft}
              placeholderTextColor={t.input.placeholder}
              selectionColor={t.primary}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              style={{
                flex: 1,
                height: 48,
                borderWidth: 1,
                borderColor: focused ? t.input.focusBorder : t.input.border,
                borderRadius: t.radius.input,
                color: t.input.text,
                backgroundColor: t.input.background,
                paddingHorizontal: 14,
                paddingVertical: 0,
                fontSize: 14,
                includeFontPadding: false,
                textAlignVertical: 'center',
              }}
            />
            <View
              accessibilityLabel="发送按钮外观"
              style={{
                height: 48,
                width: 48,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: t.radius.action,
                backgroundColor: draft ? t.action : t.disabled.background,
              }}
            >
              <Text style={{ color: draft ? t.onPrimary : t.disabled.text, fontSize: 22 }}>↑</Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
