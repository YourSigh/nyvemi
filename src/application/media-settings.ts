import type { ImageSettings } from '../appearance/model';
import type { Storage } from '../storage/store';
import { MediaSettingsSchema } from '../media/model';
import { validateProviderConfig } from '../providers/provider';
import { validateImageSettings } from '../appearance/service';
interface BoundSecret {
  get(baseUrl?: string): Promise<string | null>;
  set(key: string, baseUrl: string): Promise<void>;
}
/** Saving configuration never invokes a model or creates a character candidate. */
export async function saveMediaConfiguration(
  store: Storage,
  input: unknown,
  drawing: ImageSettings,
  keys: { vision: string; drawing: string },
  secrets: { vision: BoundSecret; image: BoundSecret },
) {
  const checked = MediaSettingsSchema.parse(input),
    route = validateProviderConfig({
      id: 'provider',
      provider: 'openai-compatible',
      baseUrl: checked.visionBaseUrl,
      model: checked.visionModel,
      thinking: false,
    });
  const media = { ...checked, visionBaseUrl: route.baseUrl },
    image = validateImageSettings({
      ...drawing,
      provider: media.drawingEnabled ? 'seedream' : drawing.provider,
    });
  if (media.reuseImageKey && new URL(image.baseUrl).origin !== new URL(media.visionBaseUrl).origin)
    throw Error('共用Key需要识图与生图地址同域');
  if (keys.vision.trim())
    await (media.reuseImageKey ? secrets.image : secrets.vision).set(
      keys.vision.trim(),
      media.reuseImageKey ? image.baseUrl : media.visionBaseUrl,
    );
  if (keys.drawing.trim() && !media.reuseImageKey)
    await secrets.image.set(keys.drawing.trim(), image.baseUrl);
  if (media.drawingEnabled && !(await secrets.image.get(image.baseUrl)))
    throw Error('请填写生图Key');
  await store.atomic(async (tx) => {
    await tx.put('mediaSettings', media);
    await tx.put('imageSettings', image);
  });
  return {
    media,
    image,
    hasKey: Boolean(
      await (media.reuseImageKey ? secrets.image : secrets.vision).get(media.visionBaseUrl),
    ),
  };
}
