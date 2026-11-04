import { afterEach, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DesktopSection } from "./desktop";

const context = {
  user: { id: "user-1", email: "owner@example.com", name: "Owner" },
  currentOrganization: { id: "org-1", name: "Acme", role: "owner" as const },
  currentWorkspace: { id: "ws-1", name: "Default" },
};

afterEach(() => {
  delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
});

it("opens the deployment's Desktop for this account and workspace", () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
    customerProfile: {
      desktop: { urlScheme: "agentrelay-gcpproof", siteUrl: "https://gcp-proof.agentrelay.com" },
    },
  } as never;
  render(<DesktopSection context={context} />);
  const link = screen.getByRole("link", { name: /Open Agent Relay Desktop/ });
  expect(link.getAttribute("href")).toBe(
    "agentrelay-gcpproof://connect?site=https%3A%2F%2Fgcp-proof.agentrelay.com&account=user-1&workspace=ws-1",
  );
  expect(screen.getByRole("button", { name: "Copy Desktop link" })).toBeInTheDocument();
});

it("shows nothing without a runtime config (the hosted build)", () => {
  const { container } = render(<DesktopSection context={context} />);
  expect(container).toBeEmptyDOMElement();
});
