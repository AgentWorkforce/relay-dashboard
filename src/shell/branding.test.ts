import { afterEach, beforeEach, expect, it } from "vitest";
import {
  applyBranding,
  DEFAULT_BRANDING,
  parseBranding,
  resetBrandingForTests,
  branding,
  readableOn,
} from "./branding";

beforeEach(() => {
  resetBrandingForTests();
  document.head.innerHTML = "";
  document.title = "Agent Relay · Dashboard";
  delete document.documentElement.dataset.customerBrand;
});
afterEach(() => {
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
  resetBrandingForTests();
});

it("keeps the default look without a profile", () => {
  expect(parseBranding(undefined)).toEqual(DEFAULT_BRANDING);
  expect(parseBranding(null)).toEqual(DEFAULT_BRANDING);
  expect(parseBranding("Acme")).toEqual(DEFAULT_BRANDING);
  expect(parseBranding({})).toEqual(DEFAULT_BRANDING);
  applyBranding(DEFAULT_BRANDING);
  expect(document.title).toBe("Agent Relay · Dashboard");
  expect(document.querySelector("style")).toBeNull();
  expect(document.documentElement.dataset.customerBrand).toBeUndefined();
});

it("reads every field of a customer profile", () => {
  const brand = parseBranding({
    productName: " Acme Relay ",
    logo: { light: "https://acme.example/l.svg", dark: "/brand/d.svg" },
    favicon: "data:image/svg+xml;base64,PHN2Zy8+",
    accentColor: "#7c3aed",
    brandColor: "rgb(91, 33, 182)",
    supportUrl: "mailto:support@acme.example",
  });
  expect(brand).toEqual({
    productName: "Acme Relay",
    title: "Acme Relay",
    logo: { light: "https://acme.example/l.svg", dark: "/brand/d.svg" },
    favicon: "data:image/svg+xml;base64,PHN2Zy8+",
    accentColor: "#7c3aed",
    brandColor: "rgb(91, 33, 182)",
    supportUrl: "mailto:support@acme.example",
    poweredBy: true,
    custom: true,
  });
  expect(
    parseBranding({ productName: "Acme", title: "Acme Console", poweredByAgentRelay: false }),
  ).toMatchObject({ title: "Acme Console", poweredBy: false });
  expect(parseBranding({ logo: "https://acme.example/one.svg" }).logo).toEqual({
    light: "https://acme.example/one.svg",
    dark: "https://acme.example/one.svg",
  });
});

it("ignores unsafe or malformed fields one by one", () => {
  const brand = parseBranding({
    productName: "Acme",
    logo: { light: "javascript:alert(1)", dark: "//evil.example/x.svg" },
    favicon: "ftp://acme.example/f.ico",
    accentColor: "red; } body { display: none",
    brandColor: "url(https://evil.example)",
    supportUrl: "javascript:alert(1)",
    poweredByAgentRelay: "no",
  });
  expect(brand).toMatchObject({
    productName: "Acme",
    logo: null,
    favicon: null,
    accentColor: null,
    brandColor: null,
    supportUrl: null,
    poweredBy: true,
  });
});

it("applies the title, favicon and color tokens from runtime config", () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
    customerProfile: {
      productName: "Acme Relay",
      favicon: "/brand/favicon.svg",
      accentColor: "#7c3aed",
      brandColor: "#5b21b6",
    },
  } as never;
  applyBranding(branding());
  expect(document.title).toBe("Acme Relay");
  expect(document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute("href")).toBe(
    "/brand/favicon.svg",
  );
  const css = document.querySelector("style[data-customer-brand]")?.textContent ?? "";
  expect(css).toContain("--primary: #7c3aed !important");
  expect(css).toContain("--brand-button: #5b21b6 !important");
  expect(document.documentElement.dataset.customerBrand).toBe("");
});

it("drops colors outside the allowed syntax and picks readable button text", () => {
  for (const bad of ["#12345", "#1234567", "rgb(foo)", "red", "var(--x)"])
    expect(parseBranding({ productName: "Acme", accentColor: bad }).accentColor).toBeNull();
  for (const good of ["#abc", "#abcd", "#7c3aed", "#7c3aedff", "rgb(91, 33, 182)", "hsl(260 80% 50%)"])
    expect(parseBranding({ productName: "Acme", accentColor: good }).accentColor).toBe(good);
  // Long digit runs are rejected quickly (no catastrophic backtracking).
  const started = Date.now();
  expect(parseBranding({ productName: "Acme", accentColor: `rgb(${"1".repeat(400)}` }).accentColor).toBeNull();
  expect(Date.now() - started).toBeLessThan(200);
  expect(readableOn("#ffffff")).toBe("#111827");
  expect(readableOn("#fde047")).toBe("#111827");
  expect(readableOn("#5b21b6")).toBe("#ffffff");
  expect(readableOn("rgb(250, 250, 250)")).toBe("#111827");
});

it("keeps embedded images up to the profile size, but not long links", () => {
  const logo = `data:image/png;base64,${"A".repeat(10_000)}`;
  expect(parseBranding({ productName: "Acme", logo }).logo?.light).toBe(logo);
  expect(
    parseBranding({ productName: "Acme", favicon: `https://acme.example/${"a".repeat(3000)}` }).favicon,
  ).toBeNull();
});
