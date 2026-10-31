import { expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "./dashboard";
import { getAccount, getSessions } from "./api/client";
vi.mock("./api/client", () => ({
  getAccount: vi.fn(),
  getSessions: vi.fn(),
  SignedOut: class extends Error {},
}));
beforeEach(() => {
  vi.mocked(getAccount).mockResolvedValue({
    authenticated: true,
    user: { id: "u", name: "Alex" },
    currentWorkspace: { id: "w", name: "Workspace" },
  });
});
it("lists real API rows and carries workspace/source into conversation links", async () => {
  vi.mocked(getSessions).mockResolvedValue({
    items: [
      { sessionId: "same/id", source: "codex", summary: "Fix session loading" },
    ],
    nextCursor: null,
    error: false,
  });
  render(<Dashboard />);
  expect(
    await screen.findByRole("link", { name: /Fix session loading/ }),
  ).toHaveAttribute(
    "href",
    "/cloud/dashboard/sessions/same%2Fid?workspace=w&source=codex",
  );
  expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument();
});
it("shows an API failure rather than a misleading empty list", async () => {
  vi.mocked(getSessions).mockRejectedValue(new Error("History unavailable"));
  render(<Dashboard />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "History unavailable",
  );
  expect(screen.queryByText("No sessions yet.")).not.toBeInTheDocument();
});
