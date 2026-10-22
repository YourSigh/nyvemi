import type { ProviderConfig } from '../domain/models';
import { validateProviderConfig, type SecretStore } from '../providers/provider';
import type { Storage } from '../storage/store';
export async function saveProviderSettings(
  store: Storage,
  secrets: SecretStore,
  config: ProviderConfig,
  key: string,
): Promise<void> {
  const valid = validateProviderConfig(config);
  const previous = await secrets.get();
  const previousConfig = await store.get('provider', 'provider');
  if (
    !key.trim() &&
    previousConfig &&
    new URL(previousConfig.baseUrl).origin !== new URL(valid.baseUrl).origin
  )
    throw new Error('更换模型服务地址时，请重新输入该服务的 API Key');
  if (!key.trim() && !previous) throw new Error('请填写 API Key；本地无鉴权服务可填写 local');
  if (key.trim()) await secrets.set(key.trim());
  try {
    await store.put('provider', valid);
  } catch (error) {
    if (previous) await secrets.set(previous);
    else await secrets.remove();
    throw error;
  }
}
