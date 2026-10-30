/** Bound UI work even when an Android callback or a transport never settles. */
export async function themeTask<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      cancel = () => {
        controller.abort();
        reject(new Error('换色已取消'));
      };
      parent?.addEventListener('abort', cancel, { once: true });
      if (parent?.aborted) {
        cancel();
        return;
      }
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('换色等待超时，请重试'));
      }, timeoutMs);
      Promise.resolve()
        .then(() => {
          if (controller.signal.aborted) throw new Error('换色已取消');
          return work(controller.signal);
        })
        .then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', cancel);
  }
}
