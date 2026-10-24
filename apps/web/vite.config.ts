import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiTarget = `http://127.0.0.1:${process.env.PLEXY_PORT ?? 8765}`;

export default defineConfig({
  plugins: [
    tanstackRouter({
      routesDirectory: join(here, "src", "routes"),
      generatedRouteTree: join(here, "src", "routeTree.gen.ts"),
    }),
    react(),
    tailwindcss(),
  ],
  build: {
    outDir: resolve(here, "../../dist/web"),
    emptyOutDir: true,
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
