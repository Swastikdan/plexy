import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiTarget = `http://127.0.0.1:${process.env.PLEXY_PORT ?? 8765}`;

// react-compiler-runtime (pulled in by @videojs/react) opens with a "use no
// memo" directive that cannot survive a bundle boundary. React Compiler is not
// enabled in this app, so the directive has no effect on behavior. Rolldown
// exposes no check for this notice, so filter exactly this message and leave
// every other warning intact.
const logger = createLogger();
const logWarn = logger.warn.bind(logger);
logger.warn = (message, options) => {
  if (message.includes("[MODULE_LEVEL_DIRECTIVE]") && message.includes("use no memo")) return;
  logWarn(message, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [
    tanstackRouter({
      routesDirectory: join(here, "src", "routes"),
      generatedRouteTree: join(here, "src", "routeTree.gen.ts"),
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: resolve(here, "../../dist/web"),
    emptyOutDir: true,
    // hls.js ships as one ~550 kB module and is fetched only for converted
    // streams, which need its subtitle and alternate-audio support. The light
    // build drops those features, so the size stays; the watch route that
    // imports it lazily is the split that matters.
    chunkSizeWarningLimit: 600,
  },
  resolve: {
    alias: {
      "@": join(here, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "^/api/": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
