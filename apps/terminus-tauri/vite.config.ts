import { defineConfig } from "vite";

export default defineConfig({
  // Tauri expects fixed port during dev
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Tauri keeps a watching process – exclude src-tauri from vite watcher
      ignored: ["**/src-tauri/**"],
    },
  },
  // Required for Tauri to work properly
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri requires ES2021+
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
