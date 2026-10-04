export const PATCH_ROOT = "https://patching.1.arenanetworks.com";
const headers = {
  "X-Access-Key": "2043FE79-F32D-4FD7-8C27-0D47231C4F03",
  "User-Agent": "Moxi (Guild Wars interoperability client)",
  "Accept-Encoding": "identity",
};

export class PatchNetworkError extends Error {
  readonly code = "patch_network";
}

class RefusedResponse extends Error {}

let active = 0;
const waiting: Array<() => void> = [];

export function createPatchTransport(fetchResponse: typeof fetch = fetch) {
  return async (url: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> => {
    signal?.throwIfAborted();
    const address = new URL(url);
    if (
      address.origin !== PATCH_ROOT ||
      address.username ||
      address.password ||
      !Number.isSafeInteger(maxBytes) ||
      maxBytes <= 0
    )
      throw new Error("Patch request is not allowed.");
    if (active >= 8) await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      for (let attempt = 0; ; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(new Error("Patch request timed out.")),
          30_000,
        );
        try {
          const response = await fetchResponse(url, {
            headers,
            redirect: "manual",
            signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
          });
          if (response.status !== 200) {
            await response.body?.cancel();
            const message = `Patch service returned HTTP ${response.status}.`;
            if (
              [401, 403, 404].includes(response.status) ||
              (response.status >= 300 && response.status < 400)
            )
              throw new RefusedResponse(message);
            throw new Error(message);
          }
          if (Number(response.headers.get("content-length")) > maxBytes) {
            await response.body?.cancel();
            throw new RefusedResponse("Patch response exceeds its size limit.");
          }
          const reader = response.body?.getReader();
          if (!reader) throw new RefusedResponse("Patch response has no body.");
          const chunks: Uint8Array[] = [];
          let size = 0;
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > maxBytes)
                throw new RefusedResponse("Patch response exceeds its size limit.");
              chunks.push(value);
            }
          } finally {
            await reader.cancel();
            reader.releaseLock();
          }
          return Buffer.concat(chunks, size);
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof RefusedResponse) throw error;
          if (attempt === 3)
            throw new PatchNetworkError(
              error instanceof Error ? error.message : "Patch service is unavailable.",
              { cause: error },
            );
        } finally {
          clearTimeout(timer);
          controller.abort();
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => {
              signal?.removeEventListener("abort", abort);
              resolve();
            },
            1000 * 2 ** attempt,
          );
          function abort() {
            clearTimeout(timer);
            reject(signal?.reason);
          }
          signal?.addEventListener("abort", abort, { once: true });
        });
      }
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
