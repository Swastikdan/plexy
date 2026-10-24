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
import type { Level } from "./logger";

installCrashHandlers();
prepareLogDir();

async function main(): Promise<void> {
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
          const matchedSeries = q(
            `SELECT id, tmdb_id, name FROM items WHERE kind = 'series' AND match_status = 'matched' AND tmdb_id IS NOT NULL`
          ).all();
          const { hydrateItemMetadata } = await import("./hydrate");
          for (const s of matchedSeries) {
            const hasMeta = q(
              `SELECT m.id FROM item_metadata m JOIN items i ON i.id = m.item_id
               WHERE i.parent_id = ? AND i.kind = 'episode' LIMIT 1`
            ).get(Number((s as any).id));
            if (!hasMeta) {
              await hydrateItemMetadata(Number((s as any).id), "tv", Number((s as any).tmdb_id));
            }
          }
        } catch { /* background hydration */ }
      }, 1000);
    }
  } catch { /* non-fatal */ }

  const app = buildApp();
  // Bind follows the config: loopback unless LAN viewing was explicitly
  // enabled (PRD 5.10).
  const hostname = cfg.bindAddress === "0.0.0.0" ? "0.0.0.0" : "127.0.0.1";
  const port = Number(Bun.env.PORT ?? cfg.port);
  app.listen({ port, hostname });

  // Soft shutdown: finish writes, close the workers, close logs (PRD 5.1).
  const shutdown = (signal: string) => {
    log.info("server", `received ${signal}, shutting down`);
    app.stop(true);
    void stopOptimizer()
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
