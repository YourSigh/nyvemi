/** Explicit natural-language request, never an automatic preparation or voice license grant. */
export function createLocalVoiceRequest(deps: {
  state(): Promise<{ available: boolean }>;
  hasCompanion(): Promise<boolean>;
  requestReference(cid: string, query: string, signal?: AbortSignal): Promise<string>;
}) {
  return async (cid: string, query: string, signal?: AbortSignal) => {
    const state = await deps.state();
    if (signal?.aborted) throw Error('换声请求已取消');
    if (!state.available)
      return `想用「${query}」的声音，可以先准备安装包内的本机换声模型，再导入有权使用的参考录音。现在还没准备，也没有改变原声。`;
    if (!(await deps.hasCompanion()))
      return `本机换声模型已就绪。请在声音设置导入有权使用的「${query}」参考 WAV，再开启本机换声；我没有替你选择或启用公开录音。`;
    if (signal?.aborted) throw Error('换声请求已取消');
    return deps.requestReference(cid, query, signal);
  };
}
