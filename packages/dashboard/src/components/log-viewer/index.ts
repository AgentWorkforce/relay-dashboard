/**
 * Log Viewer — public barrel export.
 *
 * Re-exports the core log-viewing components and utilities so they can be
 * consumed by external packages via:
 *
 *   import { LogViewer } from "@agent-relay/dashboard/components/log-viewer"
 */

export { LogViewer, default as LogViewerDefault } from "../LogViewer";
export type { LogViewerProps, LogViewerMode } from "../LogViewer";

export { default as AgentLogPreview } from "../AgentLogPreview";

export {
  sanitizeLogContent,
  isSpinnerFragment,
  isHarnessNoisyLine,
  isRustWarningLine,
} from "../../lib/sanitize-logs";
