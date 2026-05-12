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
    // Mermaid core is lazily loaded and naturally large; raise warning limit to keep CI logs actionable.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("pdfjs-dist")) return "vendor-pdfjs";
          if (id.includes("@xterm")) return "vendor-xterm";
          if (id.includes("@tauri-apps")) return "vendor-tauri";
          // Let Rollup auto-split remaining deps to avoid one oversized catch-all chunk.
          return;
        },
      },
    },
  },
});
