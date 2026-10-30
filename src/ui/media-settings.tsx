import { saveMediaConfiguration } from '../application/media-settings';
import { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { visionSecret } from '../media/native';
import { imageSecret } from '../appearance/native';
import { defaultImageSettings, type ImageSettings } from '../appearance/model';
import { defaultMediaSettings, type MediaSettings } from '../media/model';
import { useRuntime } from './context';
import { Button, Card, ErrorText, Field, Note, Page } from './components';
import { usePalette } from '../theme/context';
export function MediaSettingsScreen() {
  const runtime = useRuntime(),
    palette = usePalette();
  const [settings, setSettings] = useState<MediaSettings>(defaultMediaSettings),
    [draw, setDraw] = useState<ImageSettings>(defaultImageSettings),
    [key, setKey] = useState(''),
    [drawKey, setDrawKey] = useState(''),
    [hasKey, setHasKey] = useState(false),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const s = await runtime.media.settings();
        setSettings(s);
        setDraw((await runtime.store.get('imageSettings', 'images')) ?? defaultImageSettings);
        setHasKey(
          s.visionSource === 'custom' &&
            Boolean(await (s.reuseImageKey ? imageSecret : visionSecret).get(s.visionBaseUrl)),
        );
      })().catch(() => setError('读取失败'));
    }, [runtime]),
  );
  const toggle = (label: string, value: boolean, change: (v: boolean) => void) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: palette.ink }}>{label}</Text>
      <Switch
        disabled={busy}
        value={value}
        trackColor={{ false: palette.line, true: palette.tint }}
        thumbColor={palette.accent}
        onValueChange={(v) => {
          setSaved(false);
          change(v);
        }}
      />
    </View>
  );
  const save = async () => {
    const result = await saveMediaConfiguration(
      runtime.store,
      settings,
      draw,
      { vision: key, drawing: drawKey },
      { vision: visionSecret, image: imageSecret },
    );
    setSettings(result.media);
    setDraw(result.image);
    setKey('');
    setDrawKey('');
    setHasKey(result.hasKey);
    setSaved(true);
  };
  return (
    <Page>
      <Card>
        <Text style={{ color: palette.ink, fontSize: 17 }}>看懂你发来的图片</Text>
        {toggle('使用聊天模型识图', settings.visionSource === 'chat', (v) => {
          setKey('');
          setSettings({ ...settings, visionSource: v ? 'chat' : 'custom' });
        })}
        {settings.visionSource === 'chat' ? (
          <Note>自动使用聊天模型和Key，DeepSeek请选择deepseek-flash。</Note>
        ) : (
          <>
            <Field
              label="识图 Base URL"
              value={settings.visionBaseUrl}
              onChangeText={(v) => setSettings({ ...settings, visionBaseUrl: v })}
              autoCapitalize="none"
            />
            <Field
              label="视觉模型 / Endpoint ID"
              value={settings.visionModel}
              onChangeText={(v) => setSettings({ ...settings, visionModel: v })}
              autoCapitalize="none"
            />
            {toggle('识图与生图共用Key', settings.reuseImageKey, (v) =>
              setSettings({ ...settings, reuseImageKey: v }),
            )}
            <Field
              label={settings.reuseImageKey ? '豆包共用 API Key' : '视觉模型 API Key'}
              placeholder={hasKey ? '已保存，留空保留' : '填入你自己的Key'}
              value={key}
              onChangeText={setKey}
              secureTextEntry
              autoCapitalize="none"
            />
          </>
        )}
      </Card>
      <Card>
        <Text style={{ color: palette.ink, fontSize: 17 }}>她画给你的图片</Text>
        {toggle('允许聊天中生图', settings.drawingEnabled, (v) =>
          setSettings({ ...settings, drawingEnabled: v }),
        )}
        {toggle('允许后台自主生图', settings.autonomousDrawing, (v) =>
          setSettings({ ...settings, autonomousDrawing: v }),
        )}
        <Field
          label="生图 Base URL"
          value={draw.baseUrl}
          onChangeText={(v) => setDraw({ ...draw, baseUrl: v })}
          autoCapitalize="none"
        />
        <Field
          label="生图模型"
          value={draw.imageModel}
          onChangeText={(v) => setDraw({ ...draw, imageModel: v })}
          autoCapitalize="none"
        />
        {settings.visionSource === 'chat' || !settings.reuseImageKey ? (
          <Field
            label="生图 API Key"
            placeholder="留空保留"
            value={drawKey}
            onChangeText={setDrawKey}
            secureTextEntry
            autoCapitalize="none"
          />
        ) : null}
        <Note>使用你自己的额度，每个角色每天最多5次生图尝试。保存设置不会生图。</Note>
      </Card>
      <ErrorText text={error} />
      {saved ? <Note>已保存</Note> : null}
      <Button
        title={busy ? '保存中…' : '保存'}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          setError('');
          void save()
            .catch((e) => setError(e instanceof Error ? e.message : '保存失败'))
            .finally(() => setBusy(false));
        }}
      />
    </Page>
  );
}
