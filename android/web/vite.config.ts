import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],
  // The Android build serves the bundle from
  // https://appassets.androidplatform.net/assets/web/index.html, so every asset URL must stay
  // relative to index.html instead of being rooted at "/".
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },

  clearScreen: false,
  server: {
    port: 1420,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
