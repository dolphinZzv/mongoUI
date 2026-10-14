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

// packageName extracts the real package name from a resolved module id. pnpm's
// virtual store embeds peer deps (e.g. `@types+react-dom@19.3.0`) in the
// directory name, so plain substring checks would misclassify packages. Using
// the segment after the last `node_modules/` avoids that.
function packageName(id: string): string {
  const marker = "node_modules/"
  const after = id.slice(id.lastIndexOf(marker) + marker.length)
  const parts = after.split("/")
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1] ?? ""}` : parts[0]
}

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
          const pkg = packageName(id)
          if (pkg === "react" || pkg === "react-dom" || pkg === "scheduler") {
            return "react-vendor"
          }
          if (pkg.startsWith("@radix-ui/")) return "radix-vendor"
          if (pkg === "lucide-react") return "icons-vendor"
          return "vendor"
        },
      },
    },
  },
})
