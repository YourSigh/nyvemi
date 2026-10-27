import { upgradeBuiltinMeshModels } from './src/avatar/native';
import { AppearanceScreen } from './src/ui/appearance';
import { reconcileIntentionWork } from './src/proactive/requested-delivery';
import { ThemeProvider, useTheme } from './src/theme/context';
import { ThemeScreen } from './src/ui/theme';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { bridge, requestNotificationsOnLaunch } from './src/native/android';
import { resumeCompanionPresence } from './src/native/presence';
import { registerHeartbeat } from './src/native/background';
import { markAppActive } from './src/application/settings';
import { InterviewScreen } from './src/ui/interview';
import { UsageScreen } from './src/ui/usage';
import { ExperiencesScreen } from './src/ui/experiences';
import { DeveloperScreen } from './src/ui/developer';
import { TransferScreen } from './src/ui/transfer';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { getRuntime, type Runtime } from './src/application/runtime';
import { RuntimeContext } from './src/ui/context';
import { Busy, Button, ErrorText, Page } from './src/ui/components';
import { WelcomeScreen, ProviderScreen, GenerateScreen } from './src/ui/onboarding';
import { ChatScreen } from './src/ui/chat';
import { ScreenErrorBoundary } from './src/ui/error-boundary';
import { MemoryScreen } from './src/ui/memory';
import { SettingsScreen } from './src/ui/settings';
import type { Routes } from './src/ui/navigation';
const Stack = createNativeStackNavigator<Routes>();
export default function App() {
  return (
    <ThemeProvider>
      <Application />
    </ThemeProvider>
  );
}
function Application() {
  const { palette, hydrate, record } = useTheme();
  useEffect(() => {
    void bridge()
      .setNavigationBarDark(record?.preference.brightness === 'dark')
      .catch(() => {});
  }, [record?.preference.brightness]);
  const [resumeTheme, setResumeTheme] = useState(false);
  const [resumeProvider, setResumeProvider] = useState(false);
  const [skipTheme, setSkipTheme] = useState(false);
  const [runtime, setRuntime] = useState<Runtime>();
  const [resumeAppearance, setResumeAppearance] = useState(false);
  const [initial, setInitial] = useState<string>();
  const [resumeInterview, setResumeInterview] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void getRuntime()
      .then(async (r) => {
        await upgradeBuiltinMeshModels(r.store).catch(() =>
          r.diagnostics.error('', 'avatar_sample_upgrade').catch(() => undefined),
        );
        const chars = await r.store.list('characters');
        const draft = await r.store.get('interviews', 'active');
        const savedTheme = await r.themes.load();
        hydrate(savedTheme);
        const opening = await r.themes.opening();
        const provider = await r.store.get('provider', 'provider');
        setResumeProvider(!provider && Boolean(opening || savedTheme || draft));
        setSkipTheme(Boolean(savedTheme) && !opening);
        setResumeTheme(Boolean(opening) && Boolean(provider));
        if (live) {
          setRuntime(r);
          setInitial(chars[0]?.id);
          setResumeAppearance(Boolean(chars[0]?.appearancePending));
          setResumeInterview(Boolean((draft && !draft.savedCharacterId) || savedTheme));
          setReady(true);
        }
      })
      .catch(() => {
        if (live) setError('无法载入本地资料。请重试；不会清空已有数据。');
      });
    return () => {
      live = false;
    };
  }, [attempt, hydrate]);
  useEffect(() => {
    if (!runtime) return;
    void registerHeartbeat()
      .catch(() => runtime.diagnostics.error('', 'background_registration'))
      .catch(() => undefined);
    const active = () => {
      if (AppState.currentState === 'active')
        void markAppActive(runtime.store).catch(() => undefined);
    };
    const resume = () => {
      active();
      if (AppState.currentState === 'active')
        void reconcileIntentionWork(runtime.store, bridge())
          .catch(() => runtime.diagnostics.error('', 'requested_registration'))
          .catch(() => undefined);
      void resumeCompanionPresence()
        .catch(() => runtime.diagnostics.error('', 'presence_resume'))
        .catch(() => undefined);
    };
    void requestNotificationsOnLaunch().catch(() => undefined);
    resume();
    const timer = setInterval(active, 60000);
    const subscription = AppState.addEventListener('change', resume);
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [runtime]);
  return (
    <SafeAreaProvider>
      <StatusBar style={record?.preference.brightness === 'dark' ? 'light' : 'dark'} />
      <KeyboardProvider>
        <View style={{ flex: 1, backgroundColor: palette.background }}>
          {error ? (
            <Page>
              <ErrorText text={error} />
              <Button
                title="重试"
                onPress={() => {
                  setError('');
                  setAttempt((n) => n + 1);
                }}
              />
            </Page>
          ) : !runtime || !ready ? (
            <Busy />
          ) : (
            <RuntimeContext.Provider value={runtime}>
              <ScreenErrorBoundary
                report={() => {
                  void runtime.diagnostics.error('', 'render').catch(() => undefined);
                }}
              >
                <NavigationContainer
                  theme={{
                    ...DefaultTheme,
                    dark: record?.preference.brightness === 'dark',
                    colors: {
                      ...DefaultTheme.colors,
                      background: palette.background,
                      card: palette.background,
                      text: palette.ink,
                      primary: palette.accent,
                      border: palette.line,
                    },
                  }}
                  linking={{
                    prefixes: ['nyvemi://'],
                    config: { screens: { Chat: 'chat/:characterId' } },
                  }}
                >
                  <Stack.Navigator
                    initialRouteName={
                      initial
                        ? resumeAppearance
                          ? 'Appearance'
                          : 'Chat'
                        : resumeProvider
                          ? 'Provider'
                          : resumeTheme
                            ? 'Theme'
                            : resumeInterview
                              ? 'Create'
                              : 'Welcome'
                    }
                    screenOptions={{
                      headerShadowVisible: false,
                      headerBackTitle: '返回',
                      contentStyle: { backgroundColor: palette.background },
                    }}
                  >
                    <Stack.Screen
                      name="Usage"
                      component={UsageScreen}
                      options={{ title: '用量与费用' }}
                    />
                    <Stack.Screen
                      name="Welcome"
                      component={WelcomeScreen}
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="Provider"
                      component={ProviderScreen}
                      initialParams={resumeProvider ? { onboarding: true, skipTheme } : undefined}
                      options={{ title: '模型连接' }}
                    />
                    <Stack.Screen
                      name="Theme"
                      component={ThemeScreen}
                      options={{ title: '属于你的颜色' }}
                    />
                    <Stack.Screen
                      name="Create"
                      component={InterviewScreen}
                      options={{ title: '创建角色' }}
                    />
                    <Stack.Screen
                      name="Appearance"
                      component={AppearanceScreen}
                      initialParams={
                        initial ? { characterId: initial, onboarding: resumeAppearance } : undefined
                      }
                      options={{ title: '角色形象' }}
                    />
                    <Stack.Screen
                      name="Generate"
                      component={GenerateScreen}
                      options={{ title: '认识她', headerBackVisible: false, gestureEnabled: false }}
                    />
                    <Stack.Screen
                      name="Chat"
                      component={ChatScreen}
                      initialParams={initial ? { characterId: initial } : undefined}
                      options={{ headerShown: false }}
                    />
                    <Stack.Screen
                      name="Transfer"
                      component={TransferScreen}
                      options={{ title: '角色迁移' }}
                    />
                    <Stack.Screen
                      name="Developer"
                      component={DeveloperScreen}
                      options={{ title: 'Developer Mode' }}
                    />
                    <Stack.Screen
                      name="Experiences"
                      component={ExperiencesScreen}
                      options={{ title: '经历' }}
                    />
                    <Stack.Screen
                      name="Memory"
                      component={MemoryScreen}
                      options={{ title: '记忆' }}
                    />
                    <Stack.Screen
                      name="Settings"
                      component={SettingsScreen}
                      options={{ title: '关于她' }}
                    />
                  </Stack.Navigator>
                </NavigationContainer>
              </ScreenErrorBoundary>
            </RuntimeContext.Provider>
          )}
        </View>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
