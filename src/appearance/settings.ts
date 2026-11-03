import { defaultImageSettings, SEEDREAM_PRO, SEEDREAM_FLASH, type ImageSettings } from './model';
/** Upgrade only the unmarked old official preset. Explicit/new custom selections stay intact. */
export function upgradeImageSettings(saved?: ImageSettings): ImageSettings {
  if (!saved) return { ...defaultImageSettings };
  if (
    saved.routingVersion === undefined &&
    saved.provider === 'seedream' &&
    saved.baseUrl.replace(/\/+$/, '') === defaultImageSettings.baseUrl &&
    saved.imageModel === SEEDREAM_PRO &&
    saved.layerModel === SEEDREAM_PRO
  )
    return { ...saved, layerModel: SEEDREAM_FLASH, routingVersion: 1 };
  return saved;
}
export function imageRoutingLabel(settings: ImageSettings): string {
  const label = (model: string) =>
    model === SEEDREAM_PRO ? 'Pro' : model === SEEDREAM_FLASH ? 'Flash' : '自定义';
  return `生图 ${label(settings.imageModel)} · 拆层 ${label(settings.layerModel)}`;
}
export const qualityImageSettings: ImageSettings = {
  ...defaultImageSettings,
  layerModel: SEEDREAM_PRO,
};
