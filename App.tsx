import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
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
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { getRuntime, type Runtime } from './src/application/runtime';
import { RuntimeContext } from './src/ui/context';
import { Busy, Button, ErrorText, Page, palette } from './src/ui/components';
import { WelcomeScreen, ProviderScreen, GenerateScreen } from './src/ui/onboarding';
import { ChatScreen } from './src/ui/chat';
import { ScreenErrorBoundary } from './src/ui/error-boundary';
import { MemoryScreen } from './src/ui/memory';
import { SettingsScreen, CharactersScreen } from './src/ui/settings';
import type { Routes } from './src/ui/navigation';
const Stack = createNativeStackNavigator<Routes>();
export default function App() {
  const [runtime, setRuntime] = useState<Runtime>();
  const [initial, setInitial] = useState<string>();
  const [resumeInterview, setResumeInterview] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void getRuntime()
      .then(async (r) => {
        const chars = await r.store.list('characters');
        const draft = await r.store.get('interviews', 'active');
        if (live) {
          setRuntime(r);
          setInitial(chars[0]?.id);
          setResumeInterview(Boolean(draft && !draft.savedCharacterId));
          setReady(true);
        }
      })
      .catch(() => {
        if (live) setError('无法载入本地资料。请重试；不会清空已有数据。');
      });
    return () => {
      live = false;
    };
  }, [attempt]);
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
      void resumeCompanionPresence()
        .catch(() => runtime.diagnostics.error('', 'presence_resume'))
        .catch(() => undefined);
    };
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
      <StatusBar style="dark" />
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: palette.background }}>
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
                  initialRouteName={initial ? 'Chat' : resumeInterview ? 'Create' : 'Welcome'}
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
                    options={{ title: '模型连接' }}
                  />
                  <Stack.Screen
                    name="Create"
                    component={InterviewScreen}
                    options={{ title: '创建角色' }}
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
                  <Stack.Screen
                    name="Characters"
                    component={CharactersScreen}
                    options={{ title: '角色' }}
                  />
                </Stack.Navigator>
              </NavigationContainer>
            </ScreenErrorBoundary>
          </RuntimeContext.Provider>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
