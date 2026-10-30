import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = new URL(env.CLOUD_API_ORIGIN || "https://agentrelay.com");
  if (
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    (target.protocol !== "https:" &&
      !(
        target.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(target.hostname)
      ))
  ) {
    throw new Error(
      "CLOUD_API_ORIGIN must be an HTTPS origin or local HTTP origin.",
    );
  }
  return {
    plugins: [react(), tailwindcss()],
    define: {
      "import.meta.env.VITE_CLOUD_ORIGIN": JSON.stringify(
        env.VITE_CLOUD_ORIGIN || target.origin,
      ),
    },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/cloud-api": {
          target: target.origin,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/cloud-api/, "/cloud/api/v1"),
          // Only the public client surface is exposed. Cookies never cross this proxy.
          bypass(req, res) {
            const path = new URL(req.url || "/", "http://localhost").pathname;
            const read =
              req.method === "GET" &&
              /^\/cloud-api\/(?:auth\/(?:whoami|desktop\/workspaces)|workspaces\/[^/]+\/sessions)$/.test(
                path,
              );
            const write =
              req.method === "POST" &&
              /^\/cloud-api\/auth\/(?:device\/(?:start|token)|token\/(?:refresh|revoke)|desktop\/workspaces)$/.test(
                path,
              );
            if (!read && !write) {
              if (res) {
                res.statusCode = 404;
                res.end();
              }
              return false;
            }
          },
          configure(proxy) {
            proxy.on("proxyReq", (req) => {
              req.removeHeader("cookie");
              req.removeHeader("origin");
            });
            proxy.on("proxyRes", (res) => {
              delete res.headers["set-cookie"];
              res.headers["cache-control"] = "no-store";
            });
          },
        },
      },
    },
    preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  };
});
