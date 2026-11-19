#!/usr/bin/env bun
/**
 * Capture a Plexy web screen through the QA Chrome instance (CDP).
 *
 *   bun qa/ui-parity/cdp-capture.mjs --url http://127.0.0.1:5173/ \
 *     --out shots/ui-loop/home/iter-1.png --width 1440 --height 960
 *
 * The Chrome instance must be started with --remote-debugging-port (9334 by
 * default) and already hold a signed-in Plexy session. The capture reuses that
 * browser profile, so auth cookies are present. It never reuses a tab: each run
 * creates its own target and closes it afterwards.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i]?.replace(/^--/, "");
  const value = process.argv[i + 1];
  if (!key) continue;
  args.set(key, value ?? "true");
}

const port = args.get("port") ?? "9334";
const url = args.get("url") ?? "http://127.0.0.1:5173/";
const out = args.get("out");
const width = Number(args.get("width") ?? 1440);
const height = Number(args.get("height") ?? 960);
const full = args.get("full") === "true";
const waitMs = Number(args.get("wait") ?? 1800);
const waitFor = args.get("wait-for");
const theme = args.get("theme") ?? "dark";
const scale = Number(args.get("scale") ?? 1);
const mobile = args.get("mobile") === "true";

if (!out) {
  console.error("--out is required");
  process.exit(2);
}

const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) =>
  r.json(),
);
const ws = new WebSocket(version.webSocketDebuggerUrl);
let nextId = 0;
const pending = new Map();
const listeners = new Map();

const send = (method, params = {}, sessionId) => {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
    }, 45000);
  });
};

const on = (event, sessionId, fn) => {
  const key = sessionId ? `${sessionId}:${event}` : event;
  if (!listeners.has(key)) listeners.set(key, []);
  listeners.get(key).push(fn);
  return () => {
    const list = listeners.get(key) ?? [];
    listeners.set(key, list.filter((item) => item !== fn));
  };
};

ws.onmessage = (message) => {
  const payload = JSON.parse(message.data);
  if (payload.id) {
    const caller = pending.get(payload.id);
    if (!caller) return;
    pending.delete(payload.id);
    if (payload.error) caller.reject(new Error(payload.error.message));
    else caller.resolve(payload.result);
    return;
  }
  const key = payload.sessionId
    ? `${payload.sessionId}:${payload.method}`
    : payload.method;
  for (const fn of listeners.get(key) ?? []) fn(payload.params);
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", {
  targetId,
  flatten: true,
});

try {
  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await send("Network.enable", {}, sessionId);
  await send("Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: scale, mobile },
    sessionId,
  );
  await send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-color-scheme", value: theme }] },
    sessionId,
  );

  const loaded = new Promise((resolve) => {
    const off = on("Page.loadEventFired", sessionId, () => {
      off();
      resolve();
    });
  });
  await send("Page.navigate", { url }, sessionId);
  await Promise.race([loaded, new Promise((r) => setTimeout(r, 15000))]);

  const settle = async () => {
    await send(
      "Runtime.evaluate",
      {
        expression: `(async () => {
          try { await document.fonts.ready; } catch {}
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          return { readyState: document.readyState, title: document.title };
        })()`,
        awaitPromise: true,
      },
      sessionId,
    );
  };
  await settle();
  await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));

  if (waitFor) {
    const deadline = Date.now() + 20000;
    let found = false;
    while (Date.now() < deadline) {
      const result = await send(
        "Runtime.evaluate",
        {
          expression: `Boolean(document.querySelector(${JSON.stringify(waitFor)}))`,
          returnByValue: true,
        },
        sessionId,
      );
      if (result.result?.value) {
        found = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!found) console.error(`warning: wait-for selector not found: ${waitFor}`);
    await settle();
    await new Promise((r) => setTimeout(r, 350));
  }

  const shot = await send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: full },
    sessionId,
  );
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log(`captured ${out} (${width}x${height}${full ? " full-page" : ""})`);
} finally {
  await send("Target.closeTarget", { targetId }).catch(() => {});
  ws.close();
}
