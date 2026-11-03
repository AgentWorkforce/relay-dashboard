import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Hosted builds mount the SPA at /dashboard/. Self-hosted images build with
// DASHBOARD_BASE_PATH=/ and DASHBOARD_RUNTIME_CONFIG_URL=/runtime-config.js so
// the page loads the chart-rendered window.__AGENT_RELAY_DASHBOARD_CONFIG__.
function basePath(value: string | undefined) {
  const path = value?.trim() || "/dashboard/";
  const leading = path.startsWith("/") ? path : `/${path}`;
  return leading.endsWith("/") ? leading : `${leading}/`;
}

function runtimeConfigScript(src: string | undefined): Plugin {
  return {
    name: "agent-relay-runtime-config",
    transformIndexHtml() {
      const url = src?.trim();
      if (!url) return [];
      return [{ tag: "script", attrs: { src: url }, injectTo: "head-prepend" }];
    },
  };
}

export default defineConfig({
  base: basePath(process.env.DASHBOARD_BASE_PATH),
  plugins: [
    react(),
    runtimeConfigScript(process.env.DASHBOARD_RUNTIME_CONFIG_URL),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.local/**"],
    },
  },
});
