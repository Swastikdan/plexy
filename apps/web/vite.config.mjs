import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiTarget = `http://127.0.0.1:${process.env.PLEXY_PORT ?? 8765}`;

// react-compiler-runtime (pulled in by @videojs/react) opens with a "use no
// memo" directive that cannot survive a bundle boundary. React Compiler is not
// enabled in this app, so the directive has no effect on behavior. Rolldown
// exposes no check for this notice, so filter exactly this message and leave
// every other warning intact.
//
// One self-contained artifact for every client shape: the whole document is a
// single HTML file with the JS and CSS inlined. Nothing is fetched behind the
// boot splash except `/api/` data, so the desktop shell and the rarely visited
// site never pay a module waterfall after startup. Route splitting is off and
// the single-player chunk rides along, trading ~250 ms of one-time parse for
// zero network (or zero-hash-miss) loads afterwards.
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
      autoCodeSplitting: false,
    }),
    react(),
    tailwindcss(),
    viteSingleFile(),
  ],
  build: {
    outDir: resolve(here, "../../dist/web"),
    emptyOutDir: true,
    // Everything but the copied public/ identity files (icons, sw.js,
    // manifest) is merged into index.html — including fonts, which are
    // embedded as base64 by the singlefile plugin's recommended config.
    chunkSizeWarningLimit: 4096,
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
