// Ported from AgentWorkforce/cloud packages/web (hosted sessions dashboard).
// Keep behavior in sync with the hosted transcript renderer.
import { describe, expect, it } from "vitest";
import { sanitizeCodexPromptDisplay } from "./codex-prompt-display";
import {
  mergeReplay,
  replayResumeCommand,
  toReplayEvent,
  toReplayTurn,
} from "./replay-model";

import { mergeReplayPage } from "./replay-pages";
import { buildTranscript } from "./transcript-cells";
import type { ReplayEvent } from "./replay-model";

const prompts = (events: ReplayEvent[]) =>
  buildTranscript(events).flatMap((cell) =>
    cell.kind === "user" ? [cell.text] : [],
  );

const block = `<recommended_plugins>
Here is a list of plugins that are available but not installed.

- Dropbox (app-69b31dc2110c8191b8b47dc98fe5a052@openai-curated-remote)
- Box (box@openai-curated-remote)
- Codex Security (codex-security@openai-curated-remote)
- Figma (figma@openai-curated-remote)
- Finances (finances@openai-curated-remote)
- GitHub (github@openai-curated-remote)
- Gmail (gmail@openai-curated-remote)
- Google Calendar (google-calendar@openai-curated-remote)
- Google Drive (google-drive@openai-curated-remote)
- Linear (linear@openai-curated-remote)
- Notion (notion@openai-curated-remote)
- OpenAI Developers (openai-developers@openai-curated-remote)
- Outlook Calendar (outlook-calendar@openai-curated-remote)
- Outlook Email (outlook-email@openai-curated-remote)
- SharePoint (sharepoint@openai-curated-remote)
- Slack (slack@openai-curated-remote)
- Teams (teams@openai-curated-remote)
</recommended_plugins>`;
const agentsBlock = `# AGENTS.md instructions for ~/Projects/AgentWorkforce/cloud

<INSTRUCTIONS>
Read AGENTS.md before editing.
Keep the focused tests green.
</INSTRUCTIONS>`;

const ts = "2026-09-30T10:00:00Z";
const event = (content: string, source = "codex", kind = "prompt") => ({
  eventId: "e1",
  ts,
  kind,
  source,
  content,
});
const turn = (content: string, metadata = {}) => ({
  id: "t1",
  ts,
  role: "user",
  content,
  metadata,
});

describe("Codex recommendation display sanitizer", () => {
  it.each(["", "\n", "\n\n"])(
    "removes the supplied prefix with separator %j",
    (separator) => {
      const prompt =
        "  Fix the parser.\n\nPreserve <custom>user text</custom>.  ";
      expect(sanitizeCodexPromptDisplay(block + separator + prompt)).toBe(
        prompt,
      );
      expect(sanitizeCodexPromptDisplay(block)).toBe("");
    },
  );

  it("accepts CRLF and preserves adjacent context and user text", () => {
    const suffix =
      "<environment_context>cwd</environment_context>\nActual request";
    expect(
      sanitizeCodexPromptDisplay(block.replaceAll("\n", "\r\n") + suffix),
    ).toBe(suffix);
  });

  it.each([
    "Explain plugins that are available but not installed.",
    "Here is a list of plugins that are available but not installed.",
    `Explain this:\n${block}\nKeep it in the documentation.`,
    `\`\`\`xml\n${block}\n\`\`\``,
    block
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n"),
    `<recommended_plugins>My own list</recommended_plugins>`,
    block.replace("</recommended_plugins>", ""),
    block.replace("</recommended_plugins>", "</different_tag>"),
    block.replace(
      "<recommended_plugins>",
      '<recommended_plugins example="true">',
    ),
    block.replace("Here is a list", "Please review this list"),
    block.replace(
      "- Box (box@openai-curated-remote)",
      "Keep my important instruction.",
    ),
    block.replace("box@openai-curated-remote", "box@my-marketplace"),
    `<recommended_plugins>\nHere is a list of plugins that are available but not installed.\n</recommended_plugins>`,
    block.replace("- Box", "<recommended_plugins>\n- Box"),
  ])("preserves genuine or unrecognized content (%#)", (content) => {
    expect(sanitizeCodexPromptDisplay(content)).toBe(content);
  });
});

describe("Codex AGENTS.md display sanitizer", () => {
  it.each([
    agentsBlock,
    agentsBlock.replace(
      "~/Projects/AgentWorkforce/cloud",
      "/Users/alice/Projects/AgentWorkforce/cloud",
    ),
    agentsBlock.replaceAll("\n", "\r\n"),
  ])(
    "removes a complete injected wrapper but keeps adjacent real prompt text (%#)",
    (prefix) => {
      expect(
        sanitizeCodexPromptDisplay(
          `${prefix}\n\nPlease update AGENTS.md tests.\n  Keep this indentation.`,
        ),
      ).toBe("Please update AGENTS.md tests.\n  Keep this indentation.");
      expect(sanitizeCodexPromptDisplay(prefix)).toBe("");
    },
  );

  it.each([
    `Please summarize AGENTS.md.`,
    `Please explain this heading:\n${agentsBlock}`,
    `\`\`\`text\n${agentsBlock}\n\`\`\``,
    agentsBlock.replace("~/Projects/AgentWorkforce/cloud", "relative/project"),
    agentsBlock.replace("cloud\n\n<INSTRUCTIONS>", "cloud\n<INSTRUCTIONS>"),
    agentsBlock.replace("<INSTRUCTIONS>", '<INSTRUCTIONS type="project">'),
    agentsBlock.replace("</INSTRUCTIONS>", ""),
    agentsBlock.replace("</INSTRUCTIONS>", "</different_tag>"),
    agentsBlock.replace("</INSTRUCTIONS>", "</INSTRUCTIONS> adjacent text"),
    agentsBlock.replace(
      "Read AGENTS.md before editing.\nKeep the focused tests green.",
      "",
    ),
  ])("preserves genuine or malformed AGENTS.md content (%#)", (content) => {
    expect(sanitizeCodexPromptDisplay(content)).toBe(content);
  });

  it("keeps an authored wrapper example without Codex's heading paragraph break", () => {
    const example =
      "# AGENTS.md instructions for /work/app\n<INSTRUCTIONS>\nRun tests.\n</INSTRUCTIONS>\nExplain this example.";
    expect(mergeReplay([event(example)], [])[0].content).toBe(example);
  });

  it("removes instructions containing a standalone closing-tag example", () => {
    const prefix = agentsBlock.replace(
      "Keep the focused tests green.",
      "</INSTRUCTIONS>\nKeep the focused tests green.",
    );
    expect(sanitizeCodexPromptDisplay(`${prefix}\nFix the parser.`)).toBe(
      "Fix the parser.",
    );
  });

  it.each([`${block}\n${agentsBlock}`, `${agentsBlock}\n${block}`])(
    "removes both recognized injected prefixes in either order (%#)",
    (prefixes) => {
      expect(sanitizeCodexPromptDisplay(`${prefixes}\nShip the fix.`)).toBe(
        "Ship the fix.",
      );
      expect(sanitizeCodexPromptDisplay(prefixes)).toBe("");
      expect(prompts(mergeReplay([event(prefixes)], []))).toEqual([]);
      expect(
        prompts(
          mergeReplay(
            [],
            [turn(`${prefixes}\nShip the fix.`, { nativeCli: "codex" })],
          ),
        ),
      ).toEqual(["Ship the fix."]);
    },
  );

  it("stops at a malformed second prefix after removing a valid first one", () => {
    const unfinished = agentsBlock.replace("</INSTRUCTIONS>", "");
    expect(sanitizeCodexPromptDisplay(`${block}\n${unfinished}`)).toBe(
      unfinished,
    );
    expect(
      sanitizeCodexPromptDisplay(
        `${agentsBlock}\n<recommended_plugins>unfinished`,
      ),
    ).toBe("<recommended_plugins>unfinished");
  });
});

describe("persisted upstream recommendation preambles", () => {
  it.each([
    "Here is a list of plugins that are available but not installed. If the user's query would benefit from one of these plugins, use the `request_plugin_install` tool to suggest that they install it. Pass the parenthesized ID as `plugin_id`. For example, suggest the Google Drive plugin if the query could possibly be better answered with access to Google Drive.",
    "Here is a list of plugins that are available but not installed. If the user's query would benefit from one of these plugins, use the `request_plugin_install` tool to suggest that they install it. All entries have `tool_type: plugin`; pass `plugin` as `tool_type` and the parenthesized ID as `tool_id`. For example, suggest the Google Drive plugin if the query could possibly be better answered with access to Google Drive.",
  ])("removes an exact legacy install-instruction prefix (%#)", (preamble) => {
    const legacy = block.replace(
      "Here is a list of plugins that are available but not installed.",
      preamble,
    );
    expect(sanitizeCodexPromptDisplay(`${legacy}\nFix it`)).toBe("Fix it");
    expect(prompts(mergeReplay([event(legacy)], []))).toEqual([]);
    const edited = legacy.replace(
      "For example,",
      "Keep my instruction. For example,",
    );
    expect(sanitizeCodexPromptDisplay(edited)).toBe(edited);
    expect(sanitizeCodexPromptDisplay(`Explain:\n${legacy}`)).toBe(
      `Explain:\n${legacy}`,
    );
  });
});

describe("Codex session transcript display", () => {
  it("shows the typed text of event-only and turn-only history", () => {
    const content = `${block}\nFix the parser`;
    expect(prompts(mergeReplay([event(content)], []))).toEqual(["Fix the parser"]);
    expect(
      prompts(mergeReplay([], [turn(content, { nativeCli: "codex" })])),
    ).toEqual(["Fix the parser"]);
  });

  it("pairs first, using the complete turn and inherited Codex source", () => {
    const rows = mergeReplay(
      [{ ...event(block.slice(0, 150)), contentTruncated: true }],
      [turn(`${block}\nFix it`)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ contentTruncated: false, source: "codex" });
    expect(prompts(rows)).toEqual(["Fix it"]);
  });

  it("hides injection-only prompts without modifying raw input", () => {
    const raw = event(block);
    expect(prompts(mergeReplay([raw], [turn(block)]))).toEqual([]);
    expect(prompts(mergeReplay([], [turn(block, { nativeCli: "codex" })]))).toEqual([]);
    expect(raw.content).toBe(block);
  });

  it("does not resurrect injected prefixes when pagination rebuilds raw streams", () => {
    const prefixes = `${block}\n${agentsBlock}`;
    const rawEvent = toReplayEvent(event(prefixes))!;
    const rawTurn = toReplayTurn(turn(`${prefixes}\nFix it`))!;
    const current = {
      events: mergeReplay([event(prefixes)], []),
      streams: { events: [rawEvent], turns: [] },
      nextCursor: "next",
      turnsNextCursor: "next",
      error: null,
    };
    const page = {
      events: [rawTurn],
      streams: { events: [], turns: [rawTurn] },
      nextCursor: null,
      turnsNextCursor: null,
      error: null,
    };
    const appended = mergeReplayPage(current, page);
    expect(prompts(appended.events)).toEqual(["Fix it"]);
    expect(prompts(mergeReplayPage(appended, page).events)).toEqual(["Fix it"]);
    expect(appended.streams?.turns[0].content).toBe(`${prefixes}\nFix it`);
  });

  it("leaves assistant and tool text untouched", () => {
    for (const prefix of [block, agentsBlock]) {
      const cells = buildTranscript(mergeReplay([event(prefix, "codex", "assistant")], []));
      expect(cells).toMatchObject([{ kind: "assistant", text: prefix }]);
    }
  });

  it.each(["user", "history", "session_event"])(
    "hides injected context in native %s user events alongside turns",
    (kind) => {
      const raw = {
        ...event(`${block}\nFix it`, "codex", kind),
        actorRole: "user",
      };
      expect(prompts(mergeReplay([raw], []))).toEqual(["Fix it"]);
      expect(prompts(mergeReplay([{ ...raw, content: block }], []))).toEqual([]);
    },
  );

  it("preserves native resume ID and working directory for hidden prompts across pagination", () => {
    const rawEvent = toReplayEvent({
      ...event(block),
      projectPath: "/work/project",
    })!;
    const rawTurn = toReplayTurn(
      turn(block, { nativeResumeId: "native-123" }),
    )!;
    const replay = {
      events: mergeReplay([event(block)], [turn(block)]),
      streams: { events: [rawEvent], turns: [rawTurn] },
      nextCursor: null,
      turnsNextCursor: null,
      error: null,
    };
    expect(prompts(replay.events)).toEqual([]);
    expect(replayResumeCommand(replay, "cloud-id")).toBe(
      "cd /work/project && codex resume native-123",
    );
    const appended = mergeReplayPage(replay, {
      events: [],
      nextCursor: null,
      turnsNextCursor: null,
      error: null,
    });
    expect(replayResumeCommand(appended, "cloud-id")).toBe(
      "cd /work/project && codex resume native-123",
    );
  });

  it("hides system reminders exposed by removing the prefix", () => {
    expect(
      prompts(mergeReplay([event(`${block}<system-reminder>context</system-reminder>`)], [])),
    ).toEqual([]);
  });
});
