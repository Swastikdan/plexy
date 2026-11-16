/** Small update metadata requests get one retry; cancellation never retries. */
export class UpdateRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "UpdateRequestError";
  }
}

export class UpdateTimeoutError extends Error {
  constructor() {
    super("Update check timed out. Check your connection and try again.");
    this.name = "UpdateTimeoutError";
  }
}

export async function fetchUpdateJson(url: string, options: {
  request?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  retryDelayMs?: number;
  headers?: HeadersInit;
} = {}): Promise<{ status: number; data: unknown; link?: string | null }> {
  const request = options.request ?? fetch;
  const headers = new Headers(options.headers);
  headers.set("Cache-Control", "no-cache");
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    const interrupted = new Promise<never>((_, reject) => {
      cancel = () => {
        controller.abort();
        const error = new Error("Update check cancelled.");
        error.name = "AbortError";
        reject(error);
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new UpdateTimeoutError());
      }, options.timeoutMs ?? 15_000);
    });
    try {
      if (options.signal?.aborted) {
        cancel();
        // Consume the rejection even when the request has not started.
        return await interrupted;
      }
      return await Promise.race([
        (async () => {
          const response = await request(url, {
            signal: controller.signal,
            headers,
          });
          if (response.status === 404) return { status: 404, data: null };
          if (!response.ok) {
            const message = response.status === 403 || response.status === 429
              ? `GitHub is limiting update requests (HTTP ${response.status}). Please try again later.`
              : `Update check failed (HTTP ${response.status}).`;
            throw new UpdateRequestError(message, response.status);
          }
          // Include slow response bodies in the timeout, not just response headers.
          return { status: response.status, data: await response.json() as unknown, link: response.headers.get("link") };
        })(),
        interrupted,
      ]);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const retryable = timedOut || error instanceof TypeError ||
        (error instanceof UpdateRequestError && error.status != null && [408, 500, 502, 503, 504].includes(error.status));
      if (attempt >= 1 || !retryable) throw timedOut ? new UpdateTimeoutError() : error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(delay);
        options.signal?.removeEventListener("abort", abort);
        const error = new Error("Update check cancelled.");
        error.name = "AbortError";
        reject(error);
      };
      const delay = setTimeout(() => {
        options.signal?.removeEventListener("abort", abort);
        resolve();
      }, options.retryDelayMs ?? 750);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
    });
  }
}
