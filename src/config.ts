import { normalizeApiBase } from "./api/client";

export const apiBaseUrl = normalizeApiBase(
  import.meta.env.VITE_CLOUD_API_BASE_URL || "https://agentrelay.com/cloud/api/v1",
);
