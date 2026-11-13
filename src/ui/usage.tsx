import { usePalette } from '../theme/context';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRuntime } from './context';
import { Button, Card, ErrorText, Field, Heading, Note, Page, Details } from './components';
import {
  deepSeekPrices,
  type TokenPrice,
  type UsageRecord,
  type UsageSummary,
} from '../usage/ledger';
export function UsageScreen() {
  const palette = usePalette();
  const runtime = useRuntime();
  const [period, setPeriod] = useState<'today' | 'month' | 'all'>('month');
  const [summary, setSummary] = useState<UsageSummary[]>([]);
  const [recent, setRecent] = useState<UsageRecord[]>([]);
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [currency, setCurrency] = useState<TokenPrice['currency']>('CNY');
  const [input, setInput] = useState('');
  const [cached, setCached] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const now = new Date();
    const since =
      period === 'all'
        ? 0
        : new Date(
            now.getFullYear(),
            now.getMonth(),
            period === 'today' ? now.getDate() : 1,
          ).getTime();
    setSummary(await runtime.usage.summary(since));
    setRecent(await runtime.usage.recent());
    const config = await runtime.store.get('provider', 'provider');
    if (config) {
      setEndpoint(config.baseUrl);
      setModel(config.model);
      const price = await runtime.usage.price(config.baseUrl, config.model);
      if (price) {
        setInput(String(price.inputPerMillion));
        setCached(String(price.cachedInputPerMillion));
        setOutput(String(price.outputPerMillion));
        setCurrency(price.currency);
      } else {
        setInput('');
        setCached('');
        setOutput('');
      }
    }
  }, [runtime, period]);
  useFocusEffect(
    useCallback(() => {
      void refresh().catch(() => setError('无法读取用量账本'));
    }, [refresh]),
  );
  const save = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!input.trim() || !cached.trim() || !output.trim())
        throw new Error('请填写三项单价；免费接口可以填写 0');
      await runtime.usage.setPrice(endpoint, model, {
        currency,
        inputPerMillion: Number(input),
        cachedInputPerMillion: Number(cached),
        outputPerMillion: Number(output),
        label: '用户确认的固定单价',
      });
      setNotice('已保存。仅用于之后的请求；已有费用保留当时的单价。');
    } catch {
      setError('保存失败，请检查单价是否为有效的非负数字');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page>
      <Heading>相处的用量</Heading>
      <Note>本机用量。费用为估算，以服务商账单为准。</Note>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(
          [
            ['today', '今天'],
            ['month', '本月'],
            ['all', '累计'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            title={label}
            secondary={period !== key}
            onPress={() => setPeriod(key)}
          />
        ))}
      </View>
      <ErrorText text={error} />
      {!summary.length ? (
        <Card>
          <Note>暂无用量</Note>
        </Card>
      ) : null}
      {summary.map((s) => (
        <Card key={`${s.endpoint}:${s.model}:${s.currency}`}>
          <Text style={{ color: palette.ink, fontSize: 17, fontWeight: '600' }}>{s.model}</Text>
          <Note>{s.endpoint}</Note>
          <Text style={{ color: palette.accent, fontSize: 28 }}>
            {s.currency === '未计价'
              ? '待配置单价'
              : `${s.currency === 'CNY' ? '¥' : '$'}${s.estimatedCost.toFixed(6)}`}
          </Text>
          {s.model !== 'DeepSeek 搜索' ? (
            <Text style={{ color: palette.ink }}>
              已知输入 {s.inputTokens.toLocaleString()} · 输出 {s.outputTokens.toLocaleString()}{' '}
              token
            </Text>
          ) : null}
          <Note>
            {s.model !== 'DeepSeek 搜索'
              ? `缓存命中 ${s.cachedInputTokens.toLocaleString()} token · `
              : ''}
            {s.requests} 次请求 · {s.failures} 次失败
          </Note>
          {s.unpriced ? <Note>{s.unpriced} 次费用未计入</Note> : null}
          {s.unknownUsage ? <Note>{s.unknownUsage} 次用量不完整</Note> : null}
        </Card>
      ))}
      <Details title="调整计费单价">
        <Card>
          <Note>
            {model || '先连接聊天模型'} · {endpoint}
          </Note>
          <Note>填写每百万 token 的单价，按实际计费档位调整。</Note>
          {new URL(endpoint || 'https://example.org').hostname === 'api.deepseek.com'
            ? deepSeekPrices
                .filter(
                  (p) =>
                    p.model === model ||
                    (model === 'deepseek-v4-flash' && p.model === 'deepseek-flash'),
                )
                .map((p) => (
                  <Button
                    key={p.label}
                    title={`填入 ${p.label}`}
                    secondary
                    onPress={() => {
                      setCurrency(p.price.currency);
                      setInput(String(p.price.inputPerMillion));
                      setCached(String(p.price.cachedInputPerMillion));
                      setOutput(String(p.price.outputPerMillion));
                      setNotice('已填入参考单价，请核对后保存。');
                    }}
                  />
                ))
            : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['CNY', 'USD'] as const).map((c) => (
              <Button key={c} title={c} secondary={currency !== c} onPress={() => setCurrency(c)} />
            ))}
          </View>
          <Field
            label="输入（未命中缓存）"
            value={input}
            onChangeText={setInput}
            keyboardType="decimal-pad"
          />
          <Field
            label="输入（命中缓存）"
            value={cached}
            onChangeText={setCached}
            keyboardType="decimal-pad"
          />
          <Field label="输出" value={output} onChangeText={setOutput} keyboardType="decimal-pad" />
          <Button
            title={busy ? '保存中…' : '保存单价'}
            disabled={busy || !model}
            onPress={() => void save()}
          />
          {notice ? <Note>{notice}</Note> : null}
        </Card>
      </Details>
      <Details title={`最近请求（${recent.length}）`}>
        <Button
          title="刷新用量"
          secondary
          onPress={() => void refresh().catch(() => setError('刷新失败'))}
        />
        {recent.map((r) => (
          <Card key={r.requestId}>
            <Text style={{ color: palette.ink }}>
              {purposeLabel(r.purpose)} · {r.model}
            </Text>
            <Note>
              {new Date(r.startedAt).toLocaleString()} · {(r.duration / 1000).toFixed(1)}s ·{' '}
              {r.success ? '完成' : '失败 / 中断'}
            </Note>
            {r.purpose === 'bilibili_discovery' ? (
              <Note>按次计费</Note>
            ) : (
              <Text style={{ color: palette.ink }}>
                输入 {r.inputTokens ?? '未知'} / 输出 {r.outputTokens ?? '未知'} token
              </Text>
            )}
            <Note>
              {r.estimatedCost === undefined
                ? '费用未知 / 未计价'
                : `${r.currency} ${r.estimatedCost.toFixed(6)}（估算）`}
            </Note>
          </Card>
        ))}
      </Details>
    </Page>
  );
}
function purposeLabel(purpose: string): string {
  return (
    (
      {
        chat: '聊天',
        agent_step: '角色思考与工具',
        bilibili_discovery: 'B 站视频探索',
        image_understanding: '看图',
        visual_identity_planning: '角色外观理解',
        visual_prompt_composition: '绘图描述整理',
        visual_reference_selection: '角色参考筛选',
        visual_reference_review: '角色参考核对',
        visual_candidate_review: '生成形象核对',
        chat_image_generation: '聊天生图',
        persona_generation: '人格生成',
        persona_interview: '角色访谈',
        theme_interpretation: '颜色偏好理解',
        memory_extraction: '记忆整理',
        proactive_generation: '主动来信',
        connection_test: '连接测试',
      } as Record<string, string>
    )[purpose] ?? '其他用量'
  );
}
