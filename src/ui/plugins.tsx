import { useCallback, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDocumentAsync } from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useRuntime } from './context';
import { Button, Card, ErrorText, Field, Note, Page } from './components';
import { usePalette } from '../theme/context';
import type { InstalledPlugin, PluginPermission } from '../extensions/model';
import type { ScreenProps } from './navigation';
const labels: Record<PluginPermission, string> = {
  context: '会话上下文',
  web: '公开网页',
  memory: '角色记忆',
  experience: '保存经历',
  schedule: '后台唤醒',
  images: '识图与生图',
};
export function PluginsScreen({ route }: ScreenProps<'Plugins'>) {
  const runtime = useRuntime(),
    palette = usePalette(),
    cid = route.params.characterId;
  const [rows, setRows] = useState<InstalledPlugin[]>([]),
    [autonomy, setAutonomy] = useState(true),
    [url, setUrl] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const refresh = useCallback(async () => {
    setRows(await runtime.plugins.list(cid));
    setAutonomy((await runtime.plugins.policy(cid)).autonomy);
  }, [runtime, cid]);
  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => setError('读取插件失败'));
    }, [refresh]),
  );
  const act = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Card>
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Text style={{ color: palette.ink }}>允许她学习与安装兼容插件</Text>
          <Switch
            disabled={busy}
            value={autonomy}
            onValueChange={(value) =>
              void act(async () => {
                const policy = await runtime.plugins.policy(cid);
                await runtime.store.put('pluginPolicies', { ...policy, autonomy: value });
              })
            }
          />
        </View>
        <Note>可保存技能、组合现有工具。新增权限需你同意。</Note>
      </Card>
      <Card>
        <Field
          label="插件地址 / SKILL.md"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
        />
        <Button
          title="从地址安装"
          disabled={busy || !url.trim()}
          onPress={() => void act(() => runtime.plugins.installUrl(cid, url.trim()))}
        />
        <Button
          title="导入插件文件"
          disabled={busy}
          secondary
          onPress={() =>
            void act(async () => {
              const picked = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
              if (picked.canceled) return;
              const file = new File(picked.assets[0].uri);
              if (file.size > 64000) throw Error('插件文件不能超过64 KB');
              await runtime.plugins.install(cid, JSON.parse(await file.text()), 'file');
            })
          }
        />
      </Card>
      <ErrorText text={error} />
      {!rows.length ? (
        <Note>还没有技能。你可以让她记住一种做事方法，或把现有工具组合成新工具。</Note>
      ) : null}
      {rows.map((row) => (
        <Card key={row.id}>
          <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '600' }}>
            {row.manifest.name} · {row.manifest.version}
          </Text>
          <Text style={{ color: palette.muted }}>{row.manifest.description}</Text>
          <Note>
            {row.enabled ? '已启用' : '未启用'} ·{' '}
            {row.source === 'learned'
              ? '她学到的技能'
              : row.source === 'developed'
                ? '她组合的新工具'
                : '导入插件'}
          </Note>
          <Note>{row.manifest.permissions.map((p) => labels[p]).join('、')}</Note>
          {row.lastError ? <ErrorText text={row.lastError} /> : null}
          <Button
            title={
              row.enabled
                ? '停用'
                : row.manifest.permissions.some((p) => !row.granted.includes(p))
                  ? '同意以上权限并启用'
                  : '启用'
            }
            disabled={busy}
            onPress={() =>
              void act(() => runtime.plugins.setEnabled(cid, row.id, !row.enabled, true))
            }
          />
          {row.history.length ? (
            <Button
              secondary
              title="回退上一版本"
              disabled={busy}
              onPress={() => void act(() => runtime.plugins.rollback(cid, row.id))}
            />
          ) : null}
          <Button
            secondary
            title="导出插件"
            disabled={busy}
            onPress={() =>
              void act(async () => {
                const file = new File(Paths.cache, `${row.manifest.id}.nyplugin.json`);
                file.write(JSON.stringify(row.manifest, null, 2));
                await Sharing.shareAsync(file.uri, { mimeType: 'application/json' });
              })
            }
          />
          <Button
            secondary
            title="移除"
            disabled={busy}
            onPress={() => void act(() => runtime.plugins.remove(cid, row.id))}
          />
        </Card>
      ))}
    </Page>
  );
}
