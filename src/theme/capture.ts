// A native capture can fail or never settle. Theme changes must still work, and
// any file arriving after the deadline must be released rather than left in cache.
export async function safeSnapshot(
  capture: () => Promise<string>,
  release: (uri: string) => void,
  timeoutMs = 900,
): Promise<string | undefined> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const image = Promise.resolve()
    .then(capture)
    .then((uri) => {
      if (expired) {
        release(uri);
        return undefined;
      }
      return uri;
    })
    .catch(() => undefined);
  try {
    return await Promise.race([
      image,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
