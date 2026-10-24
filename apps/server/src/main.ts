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
import { resetInterruptedTrickplay, shutdownTrickplay } from "./trickplay";
import type { Level } from "./logger";
import { networkInterfaces } from "node:os";
import { migrateLegacyPackagedData } from "./paths";

installCrashHandlers();
prepareLogDir();

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

    if (cfg.tmdbToken) {
      setTimeout(async () => {
        try {
          const { hydrateMissingEpisodes } = await import("./hydrate");
          const repaired = await hydrateMissingEpisodes();
          if (repaired > 0) {
            log.info("tmdb", "repaired unhydrated series episodes on startup", { count: repaired });
          }
        } catch { /* background hydration */ }
      }, 1000);
    }
  } catch { /* non-fatal */ }

  const app = buildApp();
  // Bind follows the config: loopback unless LAN viewing was explicitly
  // enabled (PRD 5.10). `0.0.0.0` still accepts loopback traffic.
  const hostname = cfg.bindAddress === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const port = Number(Bun.env.PORT ?? cfg.port);
  app.listen({ port, hostname });
  resetInterruptedTrickplay();

  // Print the addresses a phone/tablet on the same Wi-Fi can actually open.
  // The server is plain HTTP; `https://` fails before a request reaches it.
  if (hostname === "0.0.0.0") {
    const lan = Object.values(networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry!.address);
    for (const address of lan) {
      log.info("server", "LAN playback address", { url: `http://${address}:${port}` });
      console.log(`▸ LAN → http://${address}:${port}`);
    }
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

  // Prepare the library in the background after the first paint of the UI.
  // Interrupted jobs are re-queued, so an unclean exit loses no work.
  setTimeout(() => {
    void startOptimizer().catch((err) =>
      log.warn("optimizer", "could not resume preparation queue", {
        message: err instanceof Error ? err.message : String(err),
      }));
  }, 3000);

  log.info("server", `Plexy v${APP_VERSION} listening`, {
    url: `http://localhost:${port}`,
    bind: hostname,
  });
  console.log(`▸ Plexy v${APP_VERSION} → http://localhost:${port}`);
}

main().catch((err) => {
  log.error("server", "failed to start", { message: err instanceof Error ? err.message : String(err) });
  console.error(err);
  process.exit(1);
});
