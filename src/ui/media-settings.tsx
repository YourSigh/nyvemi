import {
  upgradeImageSettings,
  imageRoutingLabel,
  qualityImageSettings,
} from '../appearance/settings';
import { saveMediaConfiguration } from '../application/media-settings';
import { useCallback, useState } from 'react';
import { Linking, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { visionSecret } from '../media/native';
import { imageSecret } from '../appearance/native';
import { defaultImageSettings, type ImageSettings } from '../appearance/model';
import { defaultMediaSettings, type MediaSettings } from '../media/model';
import { useRuntime } from './context';
import { Button, Card, ErrorText, Field, Note, Page, Details, TextButton } from './components';
import { usePalette } from '../theme/context';
export function MediaSettingsScreen() {
  const runtime = useRuntime(),
    palette = usePalette();
  const [settings, setSettings] = useState<MediaSettings>(defaultMediaSettings),
    [draw, setDraw] = useState<ImageSettings>(defaultImageSettings),
    [key, setKey] = useState(''),
    [drawKey, setDrawKey] = useState(''),
    [hasKey, setHasKey] = useState(false),
    [hasDrawKey, setHasDrawKey] = useState(false),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const s = await runtime.media.settings();
        setSettings(s);
        const image = (await runtime.store.get('imageSettings', 'images')) ?? defaultImageSettings;
        setDraw(upgradeImageSettings({ ...image, provider: 'seedream' }));
        setHasDrawKey(Boolean(await imageSecret.get(image.baseUrl)));
        setHasKey(
          s.visionSource === 'custom' &&
            Boolean(await (s.reuseImageKey ? imageSecret : visionSecret).get(s.visionBaseUrl)),
        );
      })().catch(() => setError('读取失败'));
    }, [runtime]),
  );
  const toggle = (label: string, value: boolean, change: (v: boolean) => void) => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: palette.ink, flex: 1, flexShrink: 1, marginRight: 12 }}>{label}</Text>
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
    setHasDrawKey(Boolean(await imageSecret.get(result.image.baseUrl)));
    setSaved(true);
  };
  return (
    <Page>
      <Card>
        <Text style={{ color: palette.ink, fontSize: 17 }}>看懂你发来的图片</Text>
        <Note>
          {settings.visionSource === 'chat'
            ? '默认使用聊天模型看图，共用已保存的密钥。'
            : '正在使用自定义识图模型。'}
        </Note>
        <Details title="自定义识图">
          {toggle('使用聊天模型识图', settings.visionSource === 'chat', (v) => {
            setKey('');
            setSettings({ ...settings, visionSource: v ? 'chat' : 'custom' });
          })}
          {settings.visionSource === 'chat' ? (
            <Note>无需额外配置。</Note>
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
        </Details>
      </Card>
      <Card>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text style={{ color: palette.ink, fontSize: 17 }}>豆包 · 画图</Text>
          <TextButton
            title="获取 Key"
            onPress={() =>
              void Linking.openURL(
                'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey',
              ).catch(() => setError('请前往火山方舟控制台创建 API Key'))
            }
          />
        </View>
        <Note>{imageRoutingLabel(draw)}；共用一个豆包Key。</Note>
        {toggle('允许聊天中生图', settings.drawingEnabled, (v) =>
          setSettings({ ...settings, drawingEnabled: v }),
        )}
        {settings.visionSource === 'chat' || !settings.reuseImageKey ? (
          <Field
            label="生图 API Key"
            placeholder={hasDrawKey ? '已保存，留空保留' : '粘贴豆包 / 火山方舟 API Key'}
            value={drawKey}
            onChangeText={(value) => {
              setDrawKey(value);
              setSaved(false);
              if (value.trim()) setSettings((current) => ({ ...current, drawingEnabled: true }));
            }}
            secureTextEntry
            autoCapitalize="none"
          />
        ) : null}
        <Details title="自定义生图与后台权限">
          <TextButton
            title="省钱组合：Pro生图 + Flash拆层"
            disabled={busy}
            onPress={() => {
              setDraw(defaultImageSettings);
              setSaved(false);
            }}
          />
          <TextButton
            title="使用Pro生图 + Pro拆层"
            disabled={busy}
            onPress={() => {
              setDraw(qualityImageSettings);
              setSaved(false);
            }}
          />
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
          <Field
            label="拆层模型"
            value={draw.layerModel}
            onChangeText={(layerModel) => setDraw({ ...draw, layerModel })}
            autoCapitalize="none"
          />

          <Note>Flash价格更低，复杂形象拆层效果可能有差异；失败不自动换用更贵模型。</Note>
          <Note>后台自主生图会使用你的额度；每个角色每天最多 5 次尝试。</Note>
        </Details>
        <Note>按服务商规则计费。保存设置不会生成图片。</Note>
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
