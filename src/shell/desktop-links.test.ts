import { expect, it } from "vitest";
import {
  desktopConnectLink,
  desktopMessageLink,
  desktopScheme,
  desktopSite,
  parseDesktopLinks,
} from "./desktop-links";

const proof = { scheme: "agentrelay-gcpproof", site: "https://gcp-proof.agentrelay.com" };

it("builds the deployment's connect link", () => {
  expect(desktopConnectLink(proof, "b79e12a1-20bf", "1c868df1-fa70")).toBe(
    "agentrelay-gcpproof://connect?site=https%3A%2F%2Fgcp-proof.agentrelay.com&account=b79e12a1-20bf&workspace=1c868df1-fa70",
  );
  expect(desktopConnectLink(proof, "a b", "ws")).toBeNull();
  expect(desktopConnectLink(proof, "u", "")).toBeNull();
});

it("builds message links only for exact addresses", () => {
  expect(desktopMessageLink(proof, "reviewer@sf-frame")).toBe(
    "agentrelay-gcpproof://message?to=reviewer%40sf-frame&site=https%3A%2F%2Fgcp-proof.agentrelay.com",
  );
  expect(desktopMessageLink(proof, "a@b@c")).toContain("to=a%40b%40c");
  for (const bad of ["reviewer", "@reviewer", "reviewer@", "re viewer@x", ""])
    expect(desktopMessageLink(proof, bad)).toBeNull();
});

it("reads the scheme and site from the customer profile", () => {
  const config = {
    customerProfile: {
      desktop: { urlScheme: "agentrelay-gcpproof", siteUrl: "https://gcp-proof.agentrelay.com/" },
    },
  };
  expect(parseDesktopLinks(config, "https://dash.example.com")).toEqual(proof);
});

it("falls back field by field and needs a runtime config", () => {
  expect(parseDesktopLinks(undefined, "https://gcp-proof.agentrelay.com")).toBeNull();
  expect(parseDesktopLinks({}, "https://gcp-proof.agentrelay.com")).toEqual({
    scheme: "agentrelay",
    site: "https://gcp-proof.agentrelay.com",
  });
  expect(
    parseDesktopLinks(
      { customerProfile: { desktop: { urlScheme: "javascript", siteUrl: "http://evil.example" } } },
      "https://relay.acme.example",
    ),
  ).toEqual({ scheme: "agentrelay", site: "https://relay.acme.example" });
  expect(parseDesktopLinks({}, "http://intranet.example")).toBeNull();
});

it("validates schemes and sites", () => {
  expect(desktopScheme(" agentrelay-gcpproof ")).toBe("agentrelay-gcpproof");
  for (const bad of ["https", "file", "data", "javascript", "Agent", "1relay", "a b", "x".repeat(65), 7])
    expect(desktopScheme(bad)).toBeNull();
  expect(desktopSite("http://localhost:3100")).toBe("http://localhost:3100");
  expect(desktopSite("https://relay.acme.example:8443")).toBe("https://relay.acme.example:8443");
  for (const bad of [
    "http://relay.acme.example",
    "https://relay.acme.example/cloud",
    "https://relay.acme.example?x=1",
    "https://user@relay.acme.example",
    "https://relay.acme.example#x",
    "relay.acme.example",
    null,
  ])
    expect(desktopSite(bad)).toBeNull();
});
