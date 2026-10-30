import { PluginManager } from '../extensions/manager';
import * as Crypto from 'expo-crypto';
import { CompanionAgent } from '../agent/service';
import { PublicAgentWeb } from '../agent/web';
import { BilibiliContentProvider } from '../exploration/content';
import { recoverVisualWork } from '../appearance/recovery';
import { imageAssets, imageHash, imageSecret } from '../appearance/native';
import { defaultImageSettings } from '../appearance/model';
import { MockImageProvider, VisualCreationService } from '../appearance/service';
import { SeedreamImageProvider } from '../appearance/seedream';
import { CharacterDebugController } from '../character/debug';
import { reconcileIntentionWork } from '../proactive/requested-delivery';
import { fetch as nativeFetch } from 'expo/fetch';
import { openStore, openDatabase, secretStore } from '../storage/native';
import { Diagnostics } from '../storage/diagnostics';
import { OpenAICompatibleProvider } from '../providers/openai';
import { type LLMProvider } from '../providers/provider';
import type { ProviderConfig } from '../domain/models';
import { ThemeService } from '../theme/service';
import { ActivityMonitor } from '../presence/activity';
import { PersonaInterview } from '../characters/interview';
import { CharacterService } from '../characters/service';
import { ChatService } from '../chat/service';
import { queueRequestedMessage } from '../chat/delayed-request';
import { saveProviderSettings } from './provider-settings';
import { MemoryRepository } from '../memory/repository';
import { MemoryRecall } from '../memory/recall';
import { KeywordMemoryRetriever } from '../memory/retrieval';
import { MemoryExtractionService } from '../memory/extraction';
import { HeartbeatEngine } from '../proactive/heartbeat/engine';
import { androidNotifications, bridge, requestNotifications } from '../native/android';
import { AppState } from 'react-native';
import { UsageLedger } from '../usage/ledger';
import { redactKnownSecret } from '../domain/privacy';
async function createRuntime() {
  if (!globalThis.crypto?.getRandomValues)
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: Crypto.getRandomValues, randomUUID: Crypto.randomUUID },
    });
  const store = await openStore();
  await recoverVisualWork(store);
  const activity = new ActivityMonitor();
  const usage = new UsageLedger(await openDatabase());
  const diagnostics = new Diagnostics(store, async (json) => {
    const key = await secretStore.get();
    return JSON.stringify(redactKnownSecret(JSON.parse(json), key ?? undefined));
  });
  const provider = async (): Promise<LLMProvider> => {
    const config = await store.get('provider', 'provider');
    if (!config) throw new Error('请先配置 Provider');
    const price = await usage.price(config.baseUrl, config.model);
    return new OpenAICompatibleProvider(
      config,
      secretStore,
      async (metric) => {
        await usage.record(metric, price).catch(() => diagnostics.error('', 'usage_ledger'));
        await diagnostics.record('api', '', { ...metric });
      },
      nativeFetch as unknown as typeof fetch,
    );
  };
  const saveProvider = (config: ProviderConfig, key: string) =>
    saveProviderSettings(store, secretStore, config, key);
  const memories = new MemoryRepository(store);
  const retriever = new KeywordMemoryRetriever();
  const extraction = new MemoryExtractionService(store, provider, diagnostics);
  const syncIntentionWork = () => reconcileIntentionWork(store, bridge());
  const agentWeb = new PublicAgentWeb(
    new BilibiliContentProvider(nativeFetch as unknown as typeof fetch),
    nativeFetch as unknown as typeof fetch,
  );
  const plugins = new PluginManager(store, {
    load: (url) => agentWeb.pluginSource(url),
    hash: imageHash,
  });
  const agent = new CompanionAgent(store, provider, diagnostics, {
    web: agentWeb,
    plugins,
    notifications: androidNotifications,
    activity: (stage, cid) => activity.report(stage, cid),
    visible: () => AppState.currentState === 'active',
    clock: () => bridge().deviceTimeContext(),
    model: async () => (await store.get('provider', 'provider'))?.model ?? 'deepseek-flash',
    redact: async (value) => redactKnownSecret(value, (await secretStore.get()) ?? undefined),
    schedule: async (task) => {
      if (AppState.currentState === 'active') {
        const character = await store.get('characters', task.characterId);
        if (character) await bridge().startPresence(character.id, character.persona.name);
      }
      await bridge().scheduleRequested(task.id, task.characterId, task.earliestAt);
    },
  });
  const chat = new ChatService(store, provider, diagnostics, {
    agent: (input) => agent.run(input),
    clock: () => bridge().deviceTimeContext(),
    scheduleRequested: async (user, delayMs) => {
      if (AppState.currentState !== 'active') throw new Error('请回到 App 后设置稍后来信');
      if (!(await requestNotifications()) || !bridge().canNotify())
        throw new Error('没有排好来信：请先在设置中允许角色通知，然后重试这条消息');
      const c = await store.get('characters', user.characterId);
      if (!c) throw new Error('角色不存在');
      await bridge().startPresence(c.id, c.persona.name);
      return queueRequestedMessage(store, user, delayMs, (task) =>
        bridge().scheduleRequested(task.id, task.characterId, task.earliestAt),
      );
    },
    retrieve: (characterId, query) =>
      new MemoryRecall(store, diagnostics).retrieve(characterId, query),
    afterRound: async (characterId, user, assistant) => {
      await extraction.enqueue(characterId, user, assistant);
      await syncIntentionWork();
      void extraction
        .drain()
        .then(syncIntentionWork)
        .catch(() => diagnostics.error(characterId, 'intention_registration'))
        .catch(() => undefined);
    },
  });
  const characters = new CharacterService(store, provider);
  return {
    store,
    agent,
    plugins,
    visuals: new VisualCreationService(
      store,
      async () => {
        const settings = (await store.get('imageSettings', 'images')) ?? defaultImageSettings;
        return settings.provider === 'mock'
          ? new MockImageProvider()
          : new SeedreamImageProvider(
              settings,
              () => imageSecret.get(settings.baseUrl),
              store,
              imageAssets,
              imageHash,
              nativeFetch as unknown as typeof fetch,
            );
      },
      imageAssets,
    ),
    characterDebug: new CharacterDebugController(),
    syncIntentionWork,
    diagnostics,
    activity,
    usage,
    provider,
    saveProvider,
    themes: new ThemeService(store, provider),
    memories,
    retriever,
    extraction,
    heartbeat: new HeartbeatEngine(
      store,
      provider,
      androidNotifications,
      diagnostics,
      Date.now,
      (stage, cid) => activity.report(stage, cid),
      agent,
    ),
    characters,
    interview: new PersonaInterview(store, provider, characters),
    chat,
  };
}
export type Runtime = Awaited<ReturnType<typeof createRuntime>>;
let pending: Promise<Runtime> | undefined;
export function getRuntime(): Promise<Runtime> {
  return (pending ??= createRuntime().catch((error) => {
    pending = undefined;
    throw error;
  }));
}
