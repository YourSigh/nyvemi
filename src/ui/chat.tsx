import { characterChatLayout } from '../character/layout';
import { useCharacterInteraction } from './character/interaction';
import { CharacterStage } from './character/stage';
import { cancelRequestedWork } from '../proactive/requested-delivery';
import { useTheme } from '../theme/context';
import { closeKeyboard } from './keyboard';
import type { Palette } from '../theme/model';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { PropsWithChildren } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Character, Message, Intention } from '../domain/models';
import { Avatar, Button, ErrorText } from './components';
import { bridge } from '../native/android';
import { useRuntime } from './context';
import type { ScreenProps } from './navigation';
function Arrival({
  children,
  messageId,
  arrivals,
}: PropsWithChildren<{ messageId: string; arrivals: Set<string> }>) {
  const animate = useRef(arrivals.has(messageId)).current;
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    arrivals.delete(messageId);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [animate, progress, arrivals, messageId]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}
export function ChatScreen({ navigation, route }: ScreenProps<'Chat'>) {
  const { palette, apply } = useTheme();
  const s = useMemo(() => createStyles(palette), [palette]);
  const runtime = useRuntime();
  const cid = route.params.characterId;
  const [needsSetup, setNeedsSetup] = useState(false);
  const [viewport, setViewport] = useState(760);
  const [composerHeight, setComposerHeight] = useState(72);
  const layout = characterChatLayout(viewport, composerHeight);
  const [requested, setRequested] = useState<Intention[]>([]);
  const [character, setCharacter] = useState<Character>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLimit, setHistoryLimit] = useState(100);
  const [hasMore, setHasMore] = useState(false);
  const autoScroll = useRef(true);
  const [draft, setDraft] = useState('');
  const interaction = useCharacterInteraction(runtime.chat, cid, Boolean(draft.trim()));
  const seen = useRef(new Set<string>());
  const arrivals = useRef(new Set<string>());
  const loaded = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const list = useRef<FlatList<Message>>(null);
  const abort = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const refresh = useCallback(async () => {
    const page = await runtime.chat.historyPage(cid, historyLimit);
    for (const message of page.messages) {
      if (
        loaded.current &&
        !seen.current.has(message.id) &&
        message.role === 'assistant' &&
        Date.now() - message.createdAt < 10000
      ) {
        arrivals.current.add(message.id);
        if (message.origin === 'proactive') interaction.incoming(message);
      }
      seen.current.add(message.id);
    }
    loaded.current = true;
    setMessages(page.messages);
    setHasMore(page.hasMore);
    setError((current) =>
      current === '读取聊天失败' || current === '读取消息失败' ? '' : current,
    );
    const c = await runtime.store.get('characters', cid);
    setCharacter(c);
    const settings = await runtime.store.get('settings', cid);
    setNeedsSetup(!settings?.proactiveEnabled || !bridge().canNotify());
    setRequested(
      (await runtime.store.list('intentions', cid, 10000))
        .filter((i) => i.type === 'requested' && i.status === 'pending' && i.latestAt > Date.now())
        .sort((a, b) => a.earliestAt - b.earliestAt),
    );

    if (!c) setError('这个角色已被清空，请重新创建。');
  }, [runtime, cid, historyLimit, interaction.incoming]);
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await runtime.chat.recoverInterrupted(cid);
        if (route.params.notificationId)
          await runtime.heartbeat.openNotification(route.params.notificationId);
        await runtime.heartbeat.openChat(cid);
        await refresh();
      })().catch(() => setError('读取聊天失败'));
      const active = async () => {
        const s = await runtime.store.get('settings', cid);
        if (s) await runtime.store.put('settings', { ...s, lastActiveAt: Date.now() });
      };
      void active().catch(() => {});
      const timer = setInterval(() => void active().catch(() => {}), 60000);
      const incoming = setInterval(() => {
        if (AppState.currentState === 'active') void refresh().catch(() => {});
      }, 3000);
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          void active().catch(() => {});
          void refresh().catch(() => {});
        }
      });
      return () => {
        clearInterval(timer);
        clearInterval(incoming);
        subscription.remove();
      };
    }, [runtime, cid, refresh, route.params.notificationId]),
  );
  useEffect(() => {
    setMessages([]);
    loaded.current = false;
    seen.current.clear();
    arrivals.current.clear();
    setHistoryLimit(100);
    autoScroll.current = true;
    return () => {
      abort.current?.abort();
    };
  }, [cid]);
  const send = async (retry?: Message) => {
    if (sending.current) return;
    const text = retry?.content ?? draft;
    if (!text.trim()) return;
    sending.current = true;
    autoScroll.current = true;
    setBusy(true);
    setError('');
    if (!retry) setDraft('');
    abort.current = new AbortController();
    try {
      await runtime.chat.send(
        cid,
        text,
        () => {},
        () => {
          void refresh().catch(() => setError('读取消息失败'));
        },
        abort.current.signal,
        retry?.id,
        async (description) => {
          await closeKeyboard();
          const current = await runtime.themes.load();
          const next = await runtime.themes.interpret(description, current?.preference);
          await apply(next, () => runtime.themes.save(next));
        },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败，消息已保留');
    } finally {
      sending.current = false;
      setBusy(false);
      void refresh().catch(() => setError('读取消息失败'));
    }
  };
  return (
    <SafeAreaView edges={['top', 'bottom']} style={s.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        <View style={{ flex: 1 }} onLayout={(e) => setViewport(e.nativeEvent.layout.height)}>
          <View style={[s.header, { height: layout.header }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={needsSetup ? '设置，通知尚未开启' : '打开设置'}
              onPress={() => navigation.navigate('Settings', { characterId: cid })}
              style={s.settingsButton}
            >
              <Text style={{ color: palette.accent, fontSize: 15 }}>设置</Text>
              {needsSetup ? (
                <View
                  style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: palette.accent }}
                />
              ) : null}
            </Pressable>
            <Text style={s.name} numberOfLines={1}>
              {character?.persona.name ?? '正在载入'}
            </Text>
            <View style={{ width: 52 }} />
          </View>
          <CharacterStage
            name={character?.persona.name ?? '她'}
            height={layout.character}
            state={interaction.state}
            intensity={interaction.intensity}
          />
          <View testID="conversation-area" style={{ flex: 1, minHeight: 0 }}>
            <View style={{ maxHeight: 42 }}>
              {requested.map((task) => (
                <View
                  key={task.id}
                  style={{
                    paddingHorizontal: 16,
                    paddingVertical: 6,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <Text style={{ flex: 1, color: palette.muted, fontSize: 12 }}>
                    约好{' '}
                    {new Date(task.requestedDueAt ?? task.earliestAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}{' '}
                    来找你
                    {!bridge().canNotify()
                      ? ' · 通知未开启'
                      : Date.now() >= task.earliestAt
                        ? ' · 正在等待送达'
                        : task.requestedDueAt && task.earliestAt > task.requestedDueAt
                          ? ' · 稍后重试'
                          : ''}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="取消这次约定来信"
                    onPress={() => {
                      void cancelRequestedWork(runtime.store, bridge(), task.id)
                        .then(refresh)
                        .catch(() => setError('取消未完成，请稍后重试'));
                    }}
                  >
                    <Text style={{ color: palette.accent, padding: 6 }}>取消</Text>
                  </Pressable>
                </View>
              ))}
            </View>
            <FlatList
              ref={list}
              data={[...messages].reverse()}
              inverted
              maintainVisibleContentPosition={{
                minIndexForVisible: 0,
                autoscrollToTopThreshold: 80,
              }}
              keyExtractor={(m) => m.id}
              contentContainerStyle={s.messages}
              onLayout={() => {
                // Keyboard changes the viewport, not the message content size.
                if (autoScroll.current)
                  requestAnimationFrame(() =>
                    list.current?.scrollToOffset({ offset: 0, animated: false }),
                  );
              }}
              onContentSizeChange={() => {
                if (autoScroll.current) list.current?.scrollToOffset({ offset: 0, animated: true });
              }}
              onScrollBeginDrag={() => {
                autoScroll.current = false;
              }}
              onScrollEndDrag={({ nativeEvent: { contentOffset } }) => {
                autoScroll.current = contentOffset.y < 80;
              }}
              onMomentumScrollEnd={({ nativeEvent: { contentOffset } }) => {
                autoScroll.current = contentOffset.y < 80;
              }}
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListFooterComponent={
                hasMore ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => {
                      autoScroll.current = false;
                      setHistoryLimit((n) => n + 100);
                    }}
                  >
                    <Text style={s.empty}>查看更早的消息</Text>
                  </Pressable>
                ) : null
              }
              ListEmptyComponent={<Text style={s.empty}>从一句随便的话开始吧。</Text>}
              renderItem={({ item: m }) => (
                <Arrival messageId={m.id} arrivals={arrivals.current}>
                  <View style={[s.row, m.role === 'user' && s.mine]}>
                    {m.role === 'assistant' ? (
                      <Avatar
                        name={character?.persona.name ?? 'N'}
                        uri={character?.avatar}
                        size={32}
                      />
                    ) : null}
                    <View style={{ maxWidth: '80%', gap: 5 }}>
                      <Text style={s.time}>
                        {new Date(m.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Text>
                      <View style={[s.bubble, m.role === 'user' && s.userBubble]}>
                        <Text selectable style={s.message}>
                          {m.content}
                        </Text>
                      </View>
                      {m.status === 'error' ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="重试消息"
                          disabled={busy}
                          onPress={() => void send(m)}
                        >
                          <Text style={{ color: palette.error, fontSize: 12 }}>
                            未收到回复 · 点此重试
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </Arrival>
              )}
            />
          </View>
          <View style={s.footer} onLayout={(e) => setComposerHeight(e.nativeEvent.layout.height)}>
            <ErrorText text={error} />
            <View style={s.composer}>
              <TextInput
                accessibilityLabel="消息"
                style={s.input}
                placeholder="说点什么…"
                placeholderTextColor={palette.muted}
                selectionColor={palette.accent}
                cursorColor={palette.accent}
                value={draft}
                onChangeText={setDraft}
                onFocus={() => {
                  autoScroll.current = true;
                  requestAnimationFrame(() =>
                    list.current?.scrollToOffset({ offset: 0, animated: false }),
                  );
                }}
                multiline
                maxLength={6000}
              />
              <Button
                title={busy ? '…' : '发送'}
                disabled={busy || !draft.trim()}
                onPress={() => void send()}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const createStyles = (palette: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: palette.background },
    header: {
      paddingHorizontal: 16,
      gap: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    settingsButton: {
      width: 52,
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    name: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '600', color: palette.ink },
    sub: { fontSize: 12, color: palette.muted, marginTop: 4 },
    more: { fontSize: 26, padding: 8, color: palette.accent },
    messages: { padding: 18, gap: 20, flexGrow: 1 },
    row: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
    mine: { justifyContent: 'flex-end' },
    bubble: {
      padding: 13,
      backgroundColor: palette.paper,
      borderRadius: 16,
      borderTopLeftRadius: 5,
      flexShrink: 1,
    },
    userBubble: { backgroundColor: palette.tint, borderTopLeftRadius: 16, borderTopRightRadius: 5 },
    message: { fontSize: 16, lineHeight: 25, color: palette.ink },
    time: { fontSize: 10, color: palette.muted, marginHorizontal: 3 },
    empty: { textAlign: 'center', color: palette.muted, marginTop: 70 },
    footer: { padding: 12, gap: 8, borderTopWidth: 1, borderColor: palette.line },
    composer: { flexDirection: 'row', gap: 9, alignItems: 'flex-end' },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 48,
      padding: 12,
      backgroundColor: palette.paper,
      borderRadius: 14,
      fontSize: 16,
      color: palette.ink,
    },
  });
