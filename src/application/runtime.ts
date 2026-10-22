import { fetch as nativeFetch } from 'expo/fetch';
import { openStore, openDatabase, secretStore } from '../storage/native';
import { Diagnostics } from '../storage/diagnostics';
import { OpenAICompatibleProvider } from '../providers/openai';
import { type LLMProvider } from '../providers/provider';
import type { ProviderConfig } from '../domain/models';
import { PersonaInterview } from '../characters/interview';
import { CharacterService } from '../characters/service';
import { ChatService } from '../chat/service';
import { saveProviderSettings } from './provider-settings';
import { MemoryRepository } from '../memory/repository';
import { KeywordMemoryRetriever } from '../memory/retrieval';
import { MemoryExtractionService } from '../memory/extraction';
import { HeartbeatEngine } from '../proactive/heartbeat/engine';
import { androidNotifications } from '../native/android';
import { UsageLedger } from '../usage/ledger';
import { redactKnownSecret } from '../domain/privacy';
async function createRuntime() {
  const store = await openStore();
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
  const chat = new ChatService(store, provider, diagnostics, {
    retrieve: async (characterId, query) => {
      const ranked = retriever.rank(query, await memories.list(characterId), Date.now());
      await memories.touch(ranked.map((r) => r.memory));
      if ((await store.get('settings', characterId))?.developerMode)
        await diagnostics.record('retrieval', characterId, {
          query,
          results: ranked.map((r) => ({
            id: r.memory.id,
            content: r.memory.content,
            score: r.score,
            keyword: r.keyword,
          })),
        });
      return ranked.map((r) => r.memory);
    },
    afterRound: async (characterId, user, assistant) => {
      await extraction.enqueue(characterId, user, assistant);
      void extraction.drain().catch(() => undefined);
    },
  });
  const characters = new CharacterService(store, provider);
  return {
    store,
    diagnostics,
    usage,
    provider,
    saveProvider,
    memories,
    retriever,
    extraction,
    heartbeat: new HeartbeatEngine(store, provider, androidNotifications, diagnostics),
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
