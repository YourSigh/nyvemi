import { useTheme } from '../theme/context';
import { useState } from 'react';
import { Text } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File } from 'expo-file-system';
import { bundleService, saveBundleToCache } from '../transfer/native';
import { readBundle, type BundleManifest } from '../transfer/bundle';
import { secretStore } from '../storage/native';
import { useRuntime } from './context';
import { Button, Card, ErrorText, Heading, Note, Page } from './components';
import type { ScreenProps } from './navigation';
export function TransferScreen({ navigation, route }: ScreenProps<'Transfer'>) {
  const { palette, hydrate } = useTheme();
  const runtime = useRuntime();
  const [bytes, setBytes] = useState<Uint8Array>();
  const [preview, setPreview] = useState<BundleManifest>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cid = route.params?.characterId;
  const choose = async () => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const file = new File(result.assets[0].uri);
      if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB');
      const content = await file.bytes();
      const parsed = readBundle(content);
      setBytes(content);
      setPreview(parsed.manifest);
    } catch {
      setError('无法读取这个 Bundle。请确认是兼容的 .nyvemi 文件且不超过 20 MB。');
    }
  };
  const importPerson = async () => {
    if (!bytes) return;
    if ((await runtime.store.list('characters')).length) {
      setError('请先在设置中备份并确认清空当前角色，再导入备份。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const character = await bundleService(runtime.store).importCharacter(bytes);
      hydrate(await runtime.themes.load());
      navigation.reset({
        index: 0,
        routes: [{ name: 'Chat', params: { characterId: character.id } }],
      });
    } catch {
      setError('导入失败，已有角色不会被覆盖。请检查文件与设备剩余空间后重试。');
    } finally {
      setBusy(false);
    }
  };
  const exportPerson = async () => {
    if (!cid) return;
    setBusy(true);
    setError('');
    try {
      const data = await bundleService(runtime.store).exportCharacter(
        cid,
        (await secretStore.get()) ?? undefined,
      );
      const uri = saveBundleToCache(data);
      if (await Sharing.isAvailableAsync())
        await Sharing.shareAsync(uri, {
          mimeType: 'application/zip',
          dialogTitle: '保存 Nyvemi 角色 Bundle',
        });
      else setNotice(`Bundle 已保存到本地缓存：${uri}`);
    } catch {
      setError('导出失败，请检查设备剩余空间、头像文件与本地数据后重试。');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Heading>迁移的是这个人</Heading>
      <Note>人格、记忆、关系状态、兴趣、经历、对话、未完成事件和头像，放进一个 .nyvemi 文件。</Note>
      <Card>
        <Note>
          不包含 API Key 和 Provider 配置。Bundle
          未加密，包含私人对话，请妥善保存。导入后主动来信暂时关闭；配置新设备模型与通知权限后可重新开启。
        </Note>
      </Card>
      {cid ? (
        <Button
          title={busy ? '处理中…' : '导出当前角色'}
          disabled={busy}
          onPress={() => void exportPerson()}
        />
      ) : null}
      <Button title="选择 .nyvemi 文件" secondary disabled={busy} onPress={() => void choose()} />
      <ErrorText text={error} />
      {notice ? <Note>{notice}</Note> : null}
      {preview ? (
        <Card>
          <Text style={{ color: palette.ink, fontSize: 20, fontWeight: '600' }}>
            {preview.character.persona.name}
          </Text>
          <Note>{preview.character.persona.identity}</Note>
          <Note>
            {preview.messages.length} 条对话 · {preview.memories.length} 条记忆 ·{' '}
            {preview.experiences.length} 个经历
          </Note>
          <Note>导入用于恢复这位角色；已有角色时，请先到设置中备份并确认清空。</Note>
          <Button title="导入这个人" disabled={busy} onPress={() => void importPerson()} />
        </Card>
      ) : null}
    </Page>
  );
}
