import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

it.each([undefined, "false", "true"])("writes the runtime visualization gate as a strict boolean (%s)", (value) => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-viz-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, DASHBOARD_HTML_ROOT: directory };
    if (value === undefined) delete env.DASHBOARD_SESSION_VISUALIZATIONS_ENABLED;
    else env.DASHBOARD_SESSION_VISUALIZATIONS_ENABLED = value;
    execFileSync("sh", [resolve("docker/40-runtime-config.sh")], { env, stdio: "pipe" });
    const context = { window: {} as { __AGENT_RELAY_DASHBOARD_CONFIG__?: { sessionVisualizations: unknown } } };
    runInNewContext(readFileSync(join(directory, "runtime-config.js"), "utf8"), context);
    expect(context.window.__AGENT_RELAY_DASHBOARD_CONFIG__?.sessionVisualizations).toBe(value === "true");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
it("refuses malformed visualization config instead of enabling it", () => {
  const directory = mkdtempSync(join(tmpdir(), "dashboard-viz-"));
  try {
    expect(() => execFileSync("sh", [resolve("docker/40-runtime-config.sh")], { env: { ...process.env, DASHBOARD_HTML_ROOT: directory, DASHBOARD_SESSION_VISUALIZATIONS_ENABLED: "yes" }, stdio: "pipe" })).toThrow();
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
