import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1430, strictPort: true },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __LOCK_PROD__: JSON.stringify(process.env.VITE_LOCK_PROD === "1"),
  },
});
