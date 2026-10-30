const configured = import.meta.env.VITE_CLOUD_API_URL;
export const apiBase =
  configured ||
  (import.meta.env.DEV ? "/cloud-api" : "https://agentrelay.com/cloud/api/v1");
export const cloudOrigin = new URL(
  import.meta.env.VITE_CLOUD_ORIGIN || "https://agentrelay.com",
).origin;
export const previewMode =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("preview") === "1";
