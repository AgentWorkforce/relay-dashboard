// Transcript rendering, following the hosted dashboard's transcript-view.tsx:
// prompts and replies as messages, agent tool activity in collapsible
// groups ("Ran", "Explored", "Edited" with diffs, "Called", plans, web), and
// stable `#message-<id>` / `#cell-<id>` anchors for citations.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, UserRound } from "lucide-react";
import { harnessName, type Member } from "./data";
import { HarnessIcon } from "./harness-icon";

import {
  transcriptCellAnchor,
  type EditedFile,
  type ExploreRow,
  type TranscriptCell,
} from "./model/transcript-cells";
import {
  groupTranscriptCells,
  isAgentActivity,
} from "./model/transcript-groups";
import type { ReplayEvent } from "./model/replay-model";
import { formatElapsed } from "./model/activity-summary";

const OUTPUT_PREVIEW_LINES = 3;
const COMMAND_PREVIEW_LINES = 3;
const DIFF_PREVIEW_LINES = 12;

function Gutter({
  glyph,
  glyphClass,
  children,
}: {
  glyph?: ReactNode;
  glyphClass?: string;
  children: ReactNode;
}) {
  return (
    <div className="gutter">
      <span aria-hidden="true" className={glyphClass}>
        {glyph}
      </span>
      <div className="gutter-body">{children}</div>
    </div>
  );
}

function Bullet({ state }: { state: "dim" | "ok" | "failed" }) {
  return <span className={`bullet bullet-${state}`}>•</span>;
}

function MoreLines({
  hidden,
  onClick,
}: {
  hidden: number;
  onClick: () => void;
}) {
  return (
    <button type="button" className="more-lines" onClick={onClick}>
      {hidden > 0
        ? `… +${hidden} ${hidden === 1 ? "line" : "lines"}`
        : "… show full output"}
    </button>
  );
}

function Output({ text, empty }: { text: string | null; empty?: string }) {
  const [open, setOpen] = useState(false);
  const lines = text ? text.replace(/\s+$/, "").split("\n") : [];
  if (!lines.length)
    return empty ? (
      <Gutter>
        <span className="dim">└ {empty}</span>
      </Gutter>
    ) : null;
  const shown = open ? lines : lines.slice(0, OUTPUT_PREVIEW_LINES);
  const clipped = !open && shown.some((line) => line.length > 120);
  const hidden = lines.length - shown.length;
  return (
    <Gutter>
      <div className="gutter dim">
        <span aria-hidden="true">└</span>
        <div className="gutter-body">
          {open ? (
            <pre className="output-full">{shown.join("\n")}</pre>
          ) : (
            shown.map((line, index) => (
              <pre key={index} className="output-line">
                {line || " "}
              </pre>
            ))
          )}
          {hidden > 0 ? (
            <MoreLines hidden={hidden} onClick={() => setOpen(true)} />
          ) : (
            clipped && <MoreLines hidden={0} onClick={() => setOpen(true)} />
          )}
        </div>
      </div>
    </Gutter>
  );
}

/** Transcript Markdown as text: never raw HTML or remote images. */
export function MessageBody({ content }: { content: string }) {
  return (
    <div className="message-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
          img: ({ alt }) => (
            <span className="dim">[Image{alt ? `: ${alt}` : ""}]</span>
          ),
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          table: ({ children }) => (
            <div className="table-scroll">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

function CommandLines({ command }: { command: string }) {
  const [open, setOpen] = useState(false);
  const [first, ...rest] = command.split("\n");
  const shown = open ? rest : rest.slice(0, COMMAND_PREVIEW_LINES - 1);
  const hidden = rest.length - shown.length;
  return (
    <>
      <span className="wrap">{first}</span>
      {shown.map((line, index) => (
        <span key={index} className="gutter">
          <span aria-hidden="true" className="dim">
            │
          </span>
          <span className="wrap">{line}</span>
        </span>
      ))}
      {hidden > 0 && (
        <span className="gutter">
          <span aria-hidden="true" className="dim">
            │
          </span>
          <MoreLines hidden={hidden} onClick={() => setOpen(true)} />
        </span>
      )}
    </>
  );
}

function ExploreLine({ row }: { row: ExploreRow }) {
  if (row.verb === "Read")
    return (
      <>
        <span className="accent">Read</span> {row.names.join(", ")}
      </>
    );
  if (row.verb === "List")
    return (
      <>
        <span className="accent">List</span> {row.detail}
      </>
    );
  return (
    <>
      <span className="accent">Search</span> {row.query}
      {row.path && (
        <>
          <span className="dim"> in </span>
          {row.path}
        </>
      )}
    </>
  );
}

function Counts({ file }: { file: Pick<EditedFile, "added" | "removed"> }) {
  if (!file.added && !file.removed) return null;
  return (
    <>
      {" ("}
      <span className="added">+{file.added}</span>{" "}
      <span className="removed">-{file.removed}</span>
      {")"}
    </>
  );
}

function Diff({ file }: { file: EditedFile }) {
  const [open, setOpen] = useState(false);
  const shown = open ? file.lines : file.lines.slice(0, DIFF_PREVIEW_LINES);
  const hidden = file.lines.length - shown.length;
  if (!file.lines.length) return null;
  return (
    <div className="diff" aria-label={`Diff of ${file.path}`}>
      {shown.map((line, index) => (
        <div
          key={index}
          className={`diff-line ${
            line.sign === "+"
              ? "diff-add"
              : line.sign === "-"
                ? "diff-del"
                : line.sign === "⋮"
                  ? "dim"
                  : ""
          }`}
        >
          <span aria-hidden="true">{line.sign}</span>
          <span>{line.text || " "}</span>
        </div>
      ))}
      {hidden > 0 && (
        <MoreLines hidden={hidden} onClick={() => setOpen(true)} />
      )}
    </div>
  );
}

function EditedCell({
  cell,
}: {
  cell: Extract<TranscriptCell, { kind: "edited" }>;
}) {
  if (cell.failed)
    return (
      <>
        <Gutter glyph="✘" glyphClass="failed-glyph">
          <span className="failed-glyph">Failed to apply patch</span>
        </Gutter>
        <Output text={cell.output} empty="(error details unavailable)" />
      </>
    );
  const [only] = cell.files;
  if (cell.files.length === 1 && only)
    return (
      <>
        <Gutter glyph={<Bullet state="dim" />}>
          <strong>{only.verb}</strong> {only.path}
          <Counts file={only} />
        </Gutter>
        <Diff file={only} />
      </>
    );
  const total = cell.files.reduce(
    (sum, file) => ({
      added: sum.added + file.added,
      removed: sum.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
  return (
    <>
      <Gutter glyph={<Bullet state="dim" />}>
        <strong>Edited</strong> {cell.files.length} files
        <Counts file={total} />
      </Gutter>
      {cell.files.map((file, index) => (
        <div key={`${file.path}:${index}`} className="edited-file">
          <Gutter>
            <span className="dim">└ </span>
            {file.path}
            <Counts file={file} />
          </Gutter>
          <Diff file={file} />
        </div>
      ))}
    </>
  );
}

function Cell({ cell }: { cell: TranscriptCell }) {
  switch (cell.kind) {
    case "context":
      return (
        <Disclosure
          anchors={[transcriptCellAnchor(cell)]}
          label="System prompt"
        >
          <pre className="context">{cell.text}</pre>
        </Disclosure>
      );
    case "image":
      return (
        <Disclosure
          anchors={[transcriptCellAnchor(cell)]}
          label="Attached image"
        >
          <img
            src={cell.url}
            alt="Attached image"
            loading="lazy"
            className="attached-image"
          />
        </Disclosure>
      );
    case "user":
      return (
        <>
          {cell.attachments.length > 0 && (
            <p className="dim small">
              Attachments: {cell.attachments.join(" ")}
            </p>
          )}
          <MessageBody content={cell.text} />
        </>
      );
    case "assistant":
      return <MessageBody content={cell.text} />;
    case "exec":
      return (
        <>
          <Gutter glyph={<Bullet state={cell.failed ? "failed" : "ok"} />}>
            <strong>{cell.title}</strong>{" "}
            <CommandLines command={cell.command} />
          </Gutter>
          <Output
            text={cell.output}
            empty={cell.recorded ? "(no output)" : undefined}
          />
        </>
      );
    case "explored":
      return (
        <>
          <Gutter glyph={<Bullet state={cell.failed ? "failed" : "dim"} />}>
            <strong>Explored</strong>
          </Gutter>
          {cell.rows.map((row, index) => (
            <Gutter key={index}>
              <div className="gutter">
                <span aria-hidden="true" className="dim">
                  {index === 0 ? "└" : ""}
                </span>
                <span className="wrap">
                  <ExploreLine row={row} />
                </span>
              </div>
            </Gutter>
          ))}
        </>
      );
    case "edited":
      return <EditedCell cell={cell} />;
    case "called": {
      const paren = cell.invocation.indexOf("(");
      return (
        <>
          <Gutter glyph={<Bullet state={cell.failed ? "failed" : "ok"} />}>
            <strong>Called</strong>{" "}
            <span className="clamp" title={cell.invocation}>
              <span className="accent">{cell.invocation.slice(0, paren)}</span>
              <span className="dim">{cell.invocation.slice(paren)}</span>
            </span>
          </Gutter>
          <Output text={cell.output} />
        </>
      );
    }
    case "web":
      return (
        <Gutter glyph={<Bullet state="dim" />}>
          <span className="truncate">
            <strong>{cell.action}</strong> {cell.detail}
          </span>
        </Gutter>
      );
    case "plan":
      return (
        <>
          <Gutter glyph={<Bullet state="dim" />}>
            <strong>{cell.title}</strong>
          </Gutter>
          {cell.text && (
            <Gutter>
              <div
                className={cell.title === "Updated Plan" ? "dim italic" : ""}
              >
                <MessageBody content={cell.text} />
              </div>
            </Gutter>
          )}
          {cell.steps.map((step, index) => (
            <Gutter key={index}>
              <div className="plan-step">
                <span aria-hidden="true" className="dim">
                  {index === 0 ? "└" : ""}
                </span>
                <span aria-hidden="true">
                  {step.status === "completed" ? "✔" : "□"}
                </span>
                <span className={`plan-${step.status}`}>{step.text}</span>
              </div>
            </Gutter>
          ))}
        </>
      );
    case "notice":
      return (
        <>
          <Gutter glyph={<Bullet state="dim" />}>
            <span className="dim wrap">{cell.text}</span>
          </Gutter>
          <Output text={cell.output} />
        </>
      );
    case "interrupted":
      return (
        <Gutter glyph="■" glyphClass="dim">
          <span className="dim">Conversation interrupted</span>
        </Gutter>
      );
    case "worked":
      return (
        <p className="worked">
          <span>Worked for {formatElapsed(cell.durationMs)}</span>
        </p>
      );
  }
}

function currentAnchor() {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
}

/** A collapsible group that opens itself when the URL targets one of its anchors. */
function Disclosure({
  anchors,
  label,
  extra,
  children,
}: {
  anchors: string[];
  label: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => anchors.includes(currentAnchor()));
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const reveal = () => {
      const target = currentAnchor();
      if (!anchors.includes(target)) return;
      setOpen(true);
      requestAnimationFrame(() =>
        document.getElementById(target)?.scrollIntoView?.({ block: "start" }),
      );
    };
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [anchors]);
  return (
    <details
      ref={ref}
      className="disclosure"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ChevronRight aria-hidden="true" className="disclosure-chevron size-3" />
        {label}
        {extra}
      </summary>
      {open && <div className="disclosure-body">{children}</div>}
    </details>
  );
}

function ActivityGroup({ cells }: { cells: TranscriptCell[] }) {
  const failed = cells.some((cell) => "failed" in cell && cell.failed);
  const anchors = cells.map(transcriptCellAnchor);
  return (
    <li className="activity-group">
      <Disclosure
        anchors={anchors}
        label={`Activity · ${cells.length} ${cells.length === 1 ? "step" : "steps"}`}
        extra={failed ? <span className="removed"> Failed</span> : null}
      >
        <ol className="activity-cells">
          {cells.map((cell) => (
            <li key={cell.id} id={transcriptCellAnchor(cell)} tabIndex={-1}>
              <Cell cell={cell} />
              <Truncation cell={cell} />
            </li>
          ))}
        </ol>
      </Disclosure>
    </li>
  );
}

function Truncation({ cell }: { cell: TranscriptCell }) {
  return cell.truncated ? (
    <p className="truncated">Truncated by the server</p>
  ) : null;
}

const isHumanMessage = (cell: TranscriptCell) =>
  cell.kind === "user" ||
  (cell.kind === "image" && cell.startsExchange === true);

function MessageHeader({
  cell,
  event,
  members,
  source,
  onCite,
}: {
  cell: TranscriptCell;
  event?: ReplayEvent;
  members: Member[];
  source: string;
  onCite: (anchor: string) => void;
}) {
  const human = isHumanMessage(cell);
  const owner =
    human && event?.userId
      ? members.find((member) => member.id === event.userId)
      : undefined;
  const name = human
    ? owner?.name || event?.actorName || "User"
    : event?.actorName || harnessName(event?.source || source) || "Agent";
  const anchor = transcriptCellAnchor(cell);
  const harness = event?.source || source;
  // Hosted transcript-view.tsx MessageHeader: avatar or harness icon, name, time.
  return (
    <div className="message-header">
      {human ? (
        <span
          data-slot="avatar"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <UserRound className="size-3.5" aria-hidden="true" />
        </span>
      ) : (
        <HarnessIcon source={harness} className="size-4" />
      )}
      <span className="speaker">{name}</span>
      <time
        dateTime={cell.ts}
        className="text-[10px]"
        title={
          Number.isFinite(Date.parse(cell.ts))
            ? new Date(cell.ts).toLocaleString()
            : undefined
        }
      >
        {Number.isFinite(Date.parse(cell.ts))
          ? new Date(cell.ts).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })
          : ""}
      </time>
      <a
        className="cite"
        href={`#${anchor}`}
        aria-label="Link to this message"
        onClick={() => onCite(anchor)}
      >
        #
      </a>
    </div>
  );
}

export function Transcript({
  cells,
  events,
  members,
  source,
  onCite = () => {},
}: {
  cells: TranscriptCell[];
  events: ReplayEvent[];
  members: Member[];
  source: string;
  onCite?: (anchor: string) => void;
}) {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const groups = groupTranscriptCells(cells);
  if (!groups.length)
    return <p className="dim">No transcript recorded for this session yet.</p>;
  return (
    <ol className="transcript">
      {groups.map((group) => {
        const cell = group[0]!;
        if (isAgentActivity(cell))
          return (
            // The first cell is stable as later pages append steps, so an
            // expanded group stays open.
            <ActivityGroup key={group[0]!.id} cells={group} />
          );
        const message = isHumanMessage(cell) || cell.kind === "assistant";
        return (
          <li
            key={cell.id}
            id={transcriptCellAnchor(cell)}
            tabIndex={-1}
            className={`message ${isHumanMessage(cell) ? "message-human" : ""}`}
          >
            {message && (
              <MessageHeader
                cell={cell}
                event={byId.get(cell.id)}
                members={members}
                source={source}
                onCite={onCite}
              />
            )}
            <Cell cell={cell} />
            {cell.kind !== "context" && <Truncation cell={cell} />}
          </li>
        );
      })}
    </ol>
  );
}
