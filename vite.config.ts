import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

import { productionApiPlugin } from "./dev/production-api.mjs";

export default defineConfig(({ mode, command }) => ({
  define: {
    "import.meta.env.VITE_PRODUCTION_READ": JSON.stringify(
      command === "serve" && mode === "production-read",
    ),
  },
  base: "/dashboard/",
  plugins: [
    react(),
    tailwindcss(),
    ...(command === "serve" && mode === "production-read"
      ? [productionApiPlugin()]
      : []),
  ],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.local/**"],
    },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
}));
