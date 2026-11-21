import { expect, test } from "bun:test";
import { fetchUpdateJson, UpdateTimeoutError } from "@/features/settings/lib/update-request";

const options = { retryDelayMs: 0, timeoutMs: 100 };

test("transient network failure retries once and returns fresh metadata", async () => {
  let calls = 0;
  const request = (async () => {
    if (++calls === 1) throw new TypeError("Network request failed");
    return Response.json({ latestVersion: "1.0.16" });
  }) as unknown as typeof fetch;
  expect((await fetchUpdateJson("https://example.com/policy", { ...options, request })).data).toEqual({ latestVersion: "1.0.16" });
  expect(calls).toBe(2);
});

test("a stuck response body is bounded even if native fetch ignores abort", async () => {
  let calls = 0;
  const signals: AbortSignal[] = [];
  const request = (async (_url: unknown, init?: RequestInit) => {
    calls++;
    signals.push(init!.signal!);
    return { ok: true, status: 200, json: () => new Promise(() => {}) } as Response;
  }) as unknown as typeof fetch;
  await expect(fetchUpdateJson("https://example.com/policy", { ...options, timeoutMs: 10, request })).rejects.toBeInstanceOf(UpdateTimeoutError);
  expect(calls).toBe(2);
  expect(signals.every(signal => signal.aborted)).toBe(true);
});

test("temporary server failures retry but rate limits and invalid JSON do not", async () => {
  for (const status of [503, 403, 429]) {
    let calls = 0;
    const request = (async () => { calls++; return new Response("unavailable", { status }); }) as unknown as typeof fetch;
    await expect(fetchUpdateJson("https://example.com/policy", { ...options, request })).rejects.toThrow(`HTTP ${status}`);
    expect(calls).toBe(status === 503 ? 2 : 1);
  }
  let calls = 0;
  const request = (async () => { calls++; return new Response("invalid json"); }) as unknown as typeof fetch;
  await expect(fetchUpdateJson("https://example.com/policy", { ...options, request })).rejects.toBeInstanceOf(SyntaxError);
  expect(calls).toBe(1);
});

test("caller cancellation stops an in-flight request without retrying", async () => {
  const controller = new AbortController();
  let calls = 0;
  const request = (() => {
    calls++;
    queueMicrotask(() => controller.abort());
    return new Promise(() => {});
  }) as unknown as typeof fetch;
  await expect(fetchUpdateJson("https://example.com/policy", { ...options, request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(1);
});

test("already cancelled checks never send a request", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const request = (async () => { calls++; return Response.json({}); }) as unknown as typeof fetch;
  await expect(fetchUpdateJson("https://example.com/policy", { ...options, request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(0);
});

test("missing policy returns 404 for the legacy fallback and pagination links survive", async () => {
  const request = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  expect((await fetchUpdateJson("https://example.com/policy", { ...options, request })).status).toBe(404);
  const paginated = (async () => Response.json([], { headers: { link: '<page2>; rel="next"' } })) as unknown as typeof fetch;
  expect((await fetchUpdateJson("https://example.com/releases", { ...options, request: paginated })).link).toContain('rel="next"');
});
