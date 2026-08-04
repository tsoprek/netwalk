import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1430, strictPort: true },
  // esbuild can corrupt xterm's requestMode enum while minifying the final
  // bundle, causing Vim's DECRQM probes to stop terminal output processing.
  // Terser preserves the local enum binding while keeping release bundles
  // minified.
  build: { minify: "terser" },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __LOCK_PROD__: JSON.stringify(process.env.VITE_LOCK_PROD === "1"),
  },
});
