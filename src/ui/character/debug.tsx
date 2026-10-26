import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { characterStates } from '../../character/interaction';
import { characterMotions } from '../../character/motion-scheduler';
import type { CharacterDebugController, CharacterDebugSnapshot } from '../../character/debug';
import { useRuntime } from '../context';
import { useCharacterTheme } from './theme';
import { CharacterStage } from './stage';
import { Button, Card, Note } from '../components';
export function useCharacterDebug(
  controller: CharacterDebugController,
  characterId: string,
  enabled: boolean,
) {
  const [snapshot, setSnapshot] = useState<CharacterDebugSnapshot>();
  useEffect(() => {
    const update = () => setSnapshot(controller.read(characterId, enabled));
    update();
    if (!enabled) return;
    const unsubscribe = controller.subscribe(update);
    const timer = setInterval(update, 1000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [controller, characterId, enabled]);
  return enabled ? snapshot : undefined;
}
export function CharacterDebugControls({ characterId }: { characterId: string }) {
  const runtime = useRuntime();
  const theme = useCharacterTheme();
  const debug = useCharacterDebug(runtime.characterDebug, characterId, true);
  return (
    <Card>
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: '600' }}>角色动作</Text>
      <CharacterStage
        name="动作预览"
        height={230}
        state={debug?.state ?? 'idle'}
        command={debug?.command}
      />
      <Note>当前：{debug?.state ?? '跟随聊天'}。手动状态 60 秒后恢复，不调用模型。</Note>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {characterStates.map((state) => (
          <Pressable
            key={state}
            accessibilityRole="button"
            accessibilityLabel={`调试状态 ${state}`}
            onPress={() => runtime.characterDebug.setState(characterId, state)}
            style={{
              padding: 10,
              borderRadius: 12,
              backgroundColor: debug?.state === state ? theme.primarySoft : theme.surface,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <Text style={{ color: theme.text }}>{state}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {characterMotions.map((motion) => (
          <Pressable
            key={motion}
            accessibilityRole="button"
            accessibilityLabel={`播放动作 ${motion}`}
            onPress={() => runtime.characterDebug.play(characterId, motion)}
            style={{ padding: 10 }}
          >
            <Text style={{ color: theme.primary }}>▶ {motion}</Text>
          </Pressable>
        ))}
      </View>
      <Button
        title="恢复跟随聊天"
        secondary
        onPress={() => runtime.characterDebug.clear(characterId)}
      />
    </Card>
  );
}
