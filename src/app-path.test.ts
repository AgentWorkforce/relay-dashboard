import { afterEach, expect, it } from "vitest";
import { appPath, loginHref, sessionVisualizationsEnabled } from "./app-path";

afterEach(() => {
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
});

it("uses the configured same-origin paths", () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
    appPath: "/",
    loginPath: "/login",
  };
  expect(appPath()).toBe("/");
  expect(loginHref("/x")).toBe("/login?next=%2Fx");
});

it("rejects protocol-relative and absolute configured paths", () => {
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example/"]) {
    window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { appPath: bad, loginPath: bad };
    expect(appPath()).toBe(import.meta.env.BASE_URL);
    expect(loginHref("/x")).toBe("/login?next=%2Fx");
  }
});

it.each([undefined, false, null, "true", 1])("requires an explicit boolean visualization flag (%s)", (value) => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: value };
  expect(sessionVisualizationsEnabled()).toBe(false);
});
it("enables visualization views only for the explicit runtime boolean", () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = { sessionVisualizations: true };
  expect(sessionVisualizationsEnabled()).toBe(true);
});
