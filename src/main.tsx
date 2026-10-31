import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { Dashboard } from "./dashboard";
import { CloudClient } from "./api/client";
import { apiBase, cloudOrigin, previewMode } from "./config";
import "@fontsource-variable/inter";
import "@fontsource-variable/sora";
import "./styles.css";

const preview =
  import.meta.env.DEV && previewMode
    ? await import("./preview").then((data) => ({
        account: data.previewAccount,
        sessions: data.previewSessions,
      }))
    : undefined;
const client = new CloudClient(apiBase, cloudOrigin);
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
});
const root = createRootRoute();
const home = createRoute({
  getParentRoute: () => root,
  path: "/",
  component: () => <Dashboard client={client} preview={preview} />,
});
const router = createRouter({
  basepath: "/dashboard",
  routeTree: root.addChildren([home]),
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
