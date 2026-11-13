import { useCallback, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  maxCharacterNameLength,
  personalityDraft,
  personalityEditable,
  personalityFields,
  updatePersonality,
  type PersonalityDraft,
} from '../characters/personality';
import { maxPersonalityNoteLength } from '../domain/models';
import { Button, Busy, ErrorText, Field, Note, Page } from './components';
import { useRuntime } from './context';
import type { ScreenProps } from './navigation';

export function PersonalitySettingsScreen({
  navigation,
  route,
}: ScreenProps<'PersonalitySettings'>) {
  const { characterId } = route.params;
  const { store } = useRuntime();
  const [draft, setDraft] = useState<PersonalityDraft>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      void store.get('characters', characterId).then(
        (character) => {
          if (!active) return;
          if (!character || !personalityEditable(character)) {
            setError(character ? '聊完开场问题后就可以编辑性格。' : '找不到这个角色。');
            return;
          }
          setDraft(personalityDraft(character.persona));
        },
        () => {
          if (active) setError('读取角色失败。');
        },
      );
      return () => {
        active = false;
      };
    }, [characterId, store]),
  );
  const change = (key: keyof PersonalityDraft, value: string) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const save = async () => {
    if (!draft || pending.current) return;
    pending.current = true;
    setSaving(true);
    setError('');
    Keyboard.dismiss();
    try {
      await updatePersonality(store, characterId, draft);
      if (navigation.isFocused()) navigation.goBack();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '保存失败，请重试。');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return (
    <Page>
      <ErrorText text={error} />
      {draft ? (
        <>
          <Field
            label="名字"
            value={draft.name}
            editable={!saving}
            maxLength={maxCharacterNameLength}
            onChangeText={(text) => change('name', text)}
          />
          {personalityFields.map(({ key, label, placeholder }) => (
            <Field
              key={key}
              label={label}
              placeholder={placeholder}
              value={draft[key]}
              multiline
              editable={!saving}
              maxLength={maxPersonalityNoteLength}
              onChangeText={(text) => change(key, text)}
            />
          ))}
          <Note>留空沿用原设定。</Note>
          <Button
            title={saving ? '正在保存…' : '保存'}
            disabled={saving || !draft.name.trim()}
            onPress={() => void save()}
          />
        </>
      ) : !error ? (
        <Busy />
      ) : null}
    </Page>
  );
}
