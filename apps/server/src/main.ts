/// Plexy entrypoint (PRD 4, 7, 12).
///
/// Boot order matters: crash handlers → migrations → config → HTTP. Shutdown
/// finishes in-flight writes (PRD 5.1), closes the media worker and the log
/// handle. Static SPA serving lives in `app.ts` so dev and prod share code.
import { runMigrations } from "./db";
import { initConfig } from "./config";
import { installCrashHandlers, APP_VERSION } from "./crash";
import { prepareLogDir, log, closeLog, setLogLevel } from "./logger";
import { buildApp } from "./app";
import { shutdownWorker } from "./worker-host";
import { startOptimizer, stopOptimizer } from "./optimize";
import { startStreamPreparation } from "./hls-preparation";
import { resetInterruptedTrickplay, shutdownTrickplay } from "./trickplay";
import type { Level } from "./logger";
import { networkInterfaces } from "node:os";
import { migrateLegacyPackagedData } from "./paths";
import { setLiveBinding } from "./runtime";

const isMediaWorker = process.argv.includes("--worker=media") || process.argv.some(a => a.endsWith("media-worker.ts") || a.endsWith("media-worker"));
const isOptimizeWorker = process.argv.includes("--worker=optimize") || process.argv.some(a => a.endsWith("optimize-worker.ts") || a.endsWith("optimize-worker"));

if (isMediaWorker) {
  await import("./media-worker");
} else if (isOptimizeWorker) {
  await import("./optimize-worker");
} else {
  installCrashHandlers();
  prepareLogDir();

  main().catch((err) => {
    log.error("server", "failed to start", { message: err instanceof Error ? err.message : String(err) });
    console.error(err);
    process.exit(1);
  });
}

async function main(): Promise<void> {
  await migrateLegacyPackagedData();
  await runMigrations();
  const cfg = await initConfig();
  const envLevel = Bun.env.PLEXY_LOG_LEVEL as Level | undefined;
  setLogLevel(envLevel ?? cfg.logLevel);

  // Maintenance: upgrade artwork URLs, link matched series episodes, clear stale image config
  try {
    const { run, q } = await import("./db");
    run(`UPDATE artwork SET url = replace(url, '/t/p/w300/', '/t/p/w1280/') WHERE kind = 'backdrop' AND url LIKE '%/t/p/w300/%'`);
    run(`UPDATE artwork SET url = replace(url, '/t/p/w342/', '/t/p/w780/') WHERE kind = 'poster' AND url LIKE '%/t/p/w342/%'`);
    run(`UPDATE artwork SET url = replace(url, '/t/p/w185/', '/t/p/w780/') WHERE kind = 'poster' AND url LIKE '%/t/p/w185/%'`);
    run(`UPDATE artwork SET url = replace(url, '/t/p/w92/', '/t/p/w300/') WHERE kind = 'thumb' AND url LIKE '%/t/p/w92/%'`);
    run(`UPDATE artwork SET url = replace(url, '/t/p/w185/', '/t/p/w300/') WHERE kind = 'thumb' AND url LIKE '%/t/p/w185/%'`);
    run(`UPDATE items SET match_status = 'matched', matched_by = 'series', tmdb_type = 'tv', score = 1
         WHERE kind = 'episode' AND match_status != 'matched'
           AND parent_id IN (SELECT id FROM items WHERE kind = 'series' AND match_status = 'matched')`);
    run(`DELETE FROM tmdb_cache WHERE key = 'tmdb/images/config'`);
    // Self-healing: reset any failed analysis files where video_codec is missing
    run(`UPDATE media_files SET analysis_status = 'pending', analysis_error = NULL WHERE (analysis_status = 'analysis_failed' OR analysis_status = 'pending') AND video_codec IS NULL`);

  } catch { /* non-fatal */ }

  const app = buildApp();
  // Bind follows the config: loopback unless LAN viewing was explicitly
  // enabled (PRD 5.10). `0.0.0.0` still accepts loopback traffic.
  const hostname = cfg.bindAddress === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const port = Number(Bun.env.PORT ?? cfg.port);
  app.listen({ port, hostname });

  // Print the addresses a phone/tablet on the same Wi-Fi can actually open.
  // The server is plain HTTP; `https://` fails before a request reaches it.
  const lanUrls =
    hostname === "0.0.0.0"
      ? Object.values(networkInterfaces())
          .flat()
          .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
          .map((entry) => `http://${entry!.address}:${port}`)
      : [];
  setLiveBinding({ bind: hostname, port, lanUrls });

  resetInterruptedTrickplay();

  for (const url of lanUrls) {
    log.info("server", "LAN playback address", { url });
    console.log(`▸ LAN → ${url}`);
  }

  // Soft shutdown: finish writes, close the workers, close logs (PRD 5.1).
  const shutdown = (signal: string) => {
    log.info("server", `received ${signal}, shutting down`);
    app.stop(true);
    void stopOptimizer()
      .then(() => shutdownTrickplay())
      .then(() => shutdownWorker())
      .then(() => {
        closeLog();
        process.exit(0);
      });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // In desktop mode, if parent Electron process exits, terminate backend cleanly
  if (process.env.PLEXY_DESKTOP) {
    process.stdin.resume();
    process.stdin.on("end", () => shutdown("parent-disconnect"));
    process.stdin.on("close", () => shutdown("parent-disconnect"));
  }

  // Prepare the library in the background after the first paint of the UI.
  // Interrupted jobs are re-queued, so an unclean exit loses no work.
  setTimeout(() => {
    void startOptimizer().catch((err) =>
      log.warn("optimizer", "could not resume preparation queue", {
        message: err instanceof Error ? err.message : String(err),
      }));
  }, 3000);

  setTimeout(() => {
    void startStreamPreparation().catch((err) =>
      log.warn("media", "could not resume adaptive stream preparation", {
        message: err instanceof Error ? err.message : String(err),
      }));
  }, 3000);

  // Trigger library scan if any media files are unprobed
  setTimeout(async () => {
    try {
      const { q } = await import("./db");
      const unprobed = q<{ c: number }>("SELECT COUNT(*) as c FROM media_files WHERE analysis_status != 'probed' OR video_codec IS NULL").get()?.c ?? 0;
      if (unprobed > 0) {
        log.info("scanner", `found ${unprobed} unprobed media files, triggering background scan`);
        const { startScan } = await import("./scan");
        startScan();
      }
    } catch {}
  }, 1500);

  log.info("server", `Plexy v${APP_VERSION} listening`, {
    url: `http://localhost:${port}`,
    bind: hostname,
  });
  console.log(`▸ Plexy v${APP_VERSION} → http://localhost:${port}`);
}
