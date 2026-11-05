import { describe, expect, it } from "vitest";
import { commandLabel, messageLabel, namedFiles, toolActionLabel } from "./trace-labels";

describe("human-readable trace actions", () => {
  it.each([
    ["gh api graphql -f query='query { repository { pullRequest(number:463) { mergeable reviewThreads(first:100) { nodes { id } } } } }'", "Check PR #463 reviews"],
    ["gh api 'repos/AgentWorkforce/relay-desktop/actions/runs/38758783212/jobs?per_page=100' --jq '[.jobs[]|{name,status}]'", "Check build and test progress"],
    ["gh run view 38758783212 --json status,conclusion,headSha,jobs", "Check build and test status"],
    ["gh pr edit 463 --body-file /tmp/final-body.md", "Update PR #463"],
    ["npm test -- --runInBand", "Run tests"],
    ["swift test --filter SearchNavigationTests", "Run tests"],
    ["node node_modules/typescript/bin/tsc --noEmit", "Check types"],
    ["git diff --stat", "Review code changes"],
    ["rg -n 'name: Test the app$|name: Build the probe$' .github/workflows", "Search project files"],
    ["python3 - <<'PY'\nprint('hello')\nPY", "Run Python script"],
    ["custom-tool --opaque '{\"nested\":true}'", "Run shell command"],
  ])("describes %s without displaying shell syntax", (input, expected) => {
    expect(commandLabel(input)).toBe(expected);
  });

  it("names files briefly and keeps opaque queries out of labels", () => {
    expect(namedFiles("Read", ["/Users/will/project/src/cache.ts"])).toBe("Read cache.ts");
    expect(namedFiles("Edit", ["one.ts", "two.ts"])).toBe("Edit 2 files");
    expect(toolActionLabel("clock.sleep", { duration_ms: 50000 })).toBe("Wait for work to finish");
    expect(toolActionLabel("collaboration.spawn_agent", {})).toBe("Delegate work to an agent");
  });

  it("condenses long status messages without claiming an unrecorded result", () => {
    expect(messageLabel("The remaining checks are the Linux arm64 app tests and macOS x64 release build. Neither has reported an error; I’m keeping the task open until they finish.")).toBe("Report build and test progress");
    expect(messageLabel("Cache fixed.")).toBe("Cache fixed");
  });
});
