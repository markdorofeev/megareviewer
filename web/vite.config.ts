import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { mockApi } from "./dev/index.ts";

// `vite --mode mock` serves the API from fixtures; otherwise /api goes to a running server
// (`pnpm dev:fake --port 4999` or `pnpm dev:server`), on MEGAREVIEWER_DEV_PORT if set.
export default defineConfig(({ mode }) => ({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), tailwindcss(), ...(mode === "mock" ? [mockApi()] : [])],
  build: {
    // `--mode design-system` builds only the preview page, for the e2e checks; never shipped.
    outDir: fileURLToPath(
      new URL(mode === "design-system" ? "../e2e/.design-system" : "../dist/web", import.meta.url),
    ),
    emptyOutDir: true,
    ...(mode === "design-system" && {
      rollupOptions: { input: fileURLToPath(new URL("design-system.html", import.meta.url)) },
    }),
    assetsDir: "assets",
    // Grammars load lazily, one chunk per language, and the C++ one is about 800 KB. They're
    // read from the local server, so their size never slows a first load.
    chunkSizeWarningLimit: 1000,
  },
  server:
    mode === "mock"
      ? {}
      : {
          proxy: {
            "/api": {
              target: `http://127.0.0.1:${process.env.MEGAREVIEWER_DEV_PORT ?? 4999}`,
              // The server's Host check allows only its own address.
              changeOrigin: true,
            },
          },
        },
}));
