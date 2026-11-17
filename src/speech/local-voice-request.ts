import type { ReferenceLookupResult } from './reference-lookup';
/** Called once by an explicit named request. Never prepares or applies voices automatically. */
export function createLocalVoiceRequest(deps: {
  state(): Promise<{ available: boolean; enabled?: boolean }>;
  find(cid: string, query: string): Promise<ReferenceLookupResult>;
  deferModel?(cid: string, query: string): void;
  appliedQuery?(cid: string): Promise<string | undefined>;
}) {
  return async (cid: string, query: string, signal?: AbortSignal) => {
    const state = await deps.state();
    if (signal?.aborted) throw Error('换声请求已取消');
    if (state.enabled && (await deps.appliedQuery?.(cid)) === query)
      return `「${query}」参考音色已应用，本机换声已开启，会复用已确认的同一段录音。`;
    if (!state.available) {
      deps.deferModel?.(cid, query);
      return `想用「${query}」的声音，先点击下载本机换声模型（117.2 MiB）。下载完成后继续查找同一角色的中文参考录音；现在没有开始下载，也没有改变原声。`;
    }
    const result = await deps.find(cid, query);
    if (signal?.aborted) throw Error('换声请求已取消');
    return (
      result.error ??
      (result.candidates.length
        ? `找到「${query}」的中文参考录音。请核对下面的来源并试听原录音；你明确确认有权使用并应用后才会切换。原声尚未改变。`
        : `没有找到可读取的「${query}」中文参考录音，原声未改变。可以重试或导入自己的 WAV。`)
    );
  };
}
