import { readFileSync } from "node:fs"
import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// The build version is injected by scripts/build.sh / GoReleaser
// (VITE_APP_VERSION). Falling back to package.json keeps `vite build` usable on
// its own. Exposing it in the bundle makes a stale embedded front-end obvious
// (the UI shows the version that was actually compiled in).
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string }
const appVersion = process.env.VITE_APP_VERSION || pkg.version

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:18099",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        // Split stable vendor code into its own long-cached chunks so the
        // app chunk stays small and cacheable across deploys.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined
          if (id.includes("react-dom") || id.includes("scheduler") || /node_modules\/react\//.test(id)) {
            return "react-vendor"
          }
          if (id.includes("@radix-ui")) return "radix-vendor"
          if (id.includes("lucide-react")) return "icons-vendor"
          return "vendor"
        },
      },
    },
  },
})
