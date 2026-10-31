export const productionRead =
  import.meta.env.DEV && import.meta.env.VITE_PRODUCTION_READ === true;
export const apiBase = productionRead
  ? "/dashboard/__production-api"
  : "/cloud/api";
export const cloudOrigin = productionRead
  ? "https://agentrelay.com"
  : window.location.origin;
export const previewMode =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("preview") === "1";
