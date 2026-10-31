export const apiBase = "/cloud/api";
export const cloudOrigin = window.location.origin;
export const previewMode =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("preview") === "1";
