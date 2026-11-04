import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { initTheme, setThemePreference } from "./theme";
import { ThemeSelector } from "./theme-selector";
import { WorkspaceChrome } from "./workspace-chrome";
import { AccountMenu } from "./account-menu";
import { WorkspaceViewSlot } from "./view-slots";
import { Shell } from "./shell";
import { resetBrandingForTests } from "./branding";
import { getAccount } from "../api/client";

vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  getAccount: vi.fn(),
}));

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
});
afterEach(() => vi.unstubAllGlobals());

it("defaults to the dark theme like hosted Cloud", () => {
  initTheme();
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.dataset.themePreference).toBe("dark");
});

it("restores a stored light or system preference", () => {
  window.localStorage.setItem("agentrelay-theme", "light");
  initTheme();
  expect(document.documentElement.dataset.theme).toBe("light");

  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: query === "(prefers-color-scheme: dark)",
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
  window.localStorage.setItem("agentrelay-theme", "system");
  initTheme();
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(document.documentElement.dataset.themePreference).toBe("system");
});

it("saves the Appearance choice and applies it", () => {
  initTheme();
  render(<ThemeSelector />);
  fireEvent.click(screen.getByRole("radio", { name: "Light" }));
  expect(window.localStorage.getItem("agentrelay-theme")).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
  act(() => setThemePreference("dark"));
  expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
});

it("marks the current rail and keeps hosted-only views out", () => {
  render(
    <WorkspaceChrome rail="Flows" label="Flows">
      <p>content</p>
    </WorkspaceChrome>,
  );
  const views = screen.getByRole("navigation", { name: "Workspace views" });
  expect(within(views).getByRole("link", { name: "Flows" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(
    within(views).getByRole("link", { name: "Sessions" }),
  ).not.toHaveAttribute("aria-current");
  expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
    "href",
    "#/settings/workspace",
  );
  for (const hosted of ["Addresses", "Billing", "Plan", "MCP"])
    expect(screen.queryByRole("link", { name: hosted })).toBeNull();
  expect(screen.getByRole("heading", { name: "Flows" })).toBeInTheDocument();
});

it("lets pages replace the heading and fill the sidebar", () => {
  render(
    <WorkspaceChrome rail="Agents" label="Sessions">
      <WorkspaceViewSlot name="heading">
        <h1>Custom heading</h1>
      </WorkspaceViewSlot>
      <WorkspaceViewSlot name="sidebar">
        <p>Filters</p>
      </WorkspaceViewSlot>
    </WorkspaceChrome>,
  );
  const aside = screen.getByRole("complementary", {
    name: "Workspace navigation",
  });
  expect(within(aside).getByText("Filters")).toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Custom heading" }),
  ).toBeInTheDocument();
});

it("collapses the sidebar and remembers it", () => {
  const chrome = (
    <WorkspaceChrome rail="Agents" label="Sessions">
      <p>content</p>
    </WorkspaceChrome>
  );
  const first = render(chrome);
  fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
  expect(
    window.localStorage.getItem("relay:workspace-navigation-collapsed"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "Expand sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");
  first.unmount();
  render(chrome);
  expect(
    screen.getByRole("button", { name: "Expand sidebar" }),
  ).toHaveAttribute("aria-expanded", "false");
});

it("keeps the route when skipping to content", () => {
  window.location.hash = "#/flows";
  render(
    <WorkspaceChrome rail="Flows" label="Flows">
      <p>content</p>
    </WorkspaceChrome>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Skip to content" }));
  expect(window.location.hash).toBe("#/flows");
  expect(document.activeElement).toBe(screen.getByRole("main"));
  window.location.hash = "";
});

it("shows the account and its workspace in the account menu", () => {
  render(<AccountMenu userName="Khaliq Gant" workspaceName="Acme" />);
  const trigger = screen.getByRole("button", {
    name: "Account and workspaces: Khaliq Gant",
  });
  expect(trigger).toHaveTextContent("Acme");
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = screen.getByRole("region", { name: "Account and workspaces" });
  expect(within(menu).getByText("Workspaces")).toBeInTheDocument();
  expect(
    within(menu).getByRole("link", { name: "Manage workspace" }),
  ).toHaveAttribute("href", "#/settings/workspace");
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("region")).toBeNull();
});

it("shows the signed-in account in the shell, and none when it fails", async () => {
  vi.mocked(getAccount).mockResolvedValueOnce({
    authenticated: true,
    user: { id: "u1", name: "Khaliq Gant" },
    currentWorkspace: { id: "w1", name: "Acme" },
  });
  const first = render(
    <Shell rail="Agents" label="Sessions">
      <p>content</p>
    </Shell>,
  );
  const trigger = await screen.findByRole("button", {
    name: "Account and workspaces: Khaliq Gant",
  });
  expect(trigger).toHaveTextContent("Acme");
  first.unmount();

  vi.mocked(getAccount).mockRejectedValueOnce(new Error("offline"));
  render(
    <Shell rail="Agents" label="Sessions">
      <p>content</p>
    </Shell>,
  );
  await act(async () => {});
  expect(screen.getByText("content")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Account and workspaces/ }),
  ).toBeNull();
});

it("renders a customer profile's brand in the chrome and account menu", () => {
  window.__AGENT_RELAY_DASHBOARD_CONFIG__ = {
    customerProfile: {
      productName: "Acme Relay",
      logo: { light: "/brand/light.svg", dark: "/brand/dark.svg" },
      supportUrl: "https://support.acme.example",
    },
  } as never;
  resetBrandingForTests();
  try {
    render(
      <WorkspaceChrome
        rail="Agents"
        label="Sessions"
        accountControl={<AccountMenu userName="Khaliq Gant" workspaceName="Acme" />}
      >
        <p>content</p>
      </WorkspaceChrome>,
    );
    const home = screen.getByRole("link", { name: "Acme Relay" });
    expect(
      [...home.querySelectorAll("img")].map((img) => img.getAttribute("src")),
    ).toEqual(["/brand/light.svg", "/brand/dark.svg"]);
    expect(screen.getByText("Powered by Agent Relay")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Account and workspaces: Khaliq Gant" }),
    );
    expect(screen.getByRole("link", { name: "Support" })).toHaveAttribute(
      "href",
      "https://support.acme.example/",
    );
  } finally {
    delete window.__AGENT_RELAY_DASHBOARD_CONFIG__;
    resetBrandingForTests();
  }
});

it("keeps the Agent Relay lockup without a profile", () => {
  resetBrandingForTests();
  render(
    <WorkspaceChrome rail="Agents" label="Sessions">
      <p>content</p>
    </WorkspaceChrome>,
  );
  expect(screen.getByRole("link", { name: "Agent Relay" })).toBeInTheDocument();
  expect(screen.queryByText("Powered by Agent Relay")).toBeNull();
});
