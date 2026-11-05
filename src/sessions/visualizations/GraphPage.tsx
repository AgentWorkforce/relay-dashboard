import { useCallback, useState } from "react";
import { sessionVisualizationsEnabled } from "../../app-path";
import { SignedOut } from "../../api/client";
import { ButtonLink } from "../../shell/ui";
import { listHref, onLinkClick } from "../route";
import { loadGraphDetail, loadGraphRelationships } from "./graph-client";
import { SessionsGraph } from "./sessions-graph";

type Props = { accountId: string; workspaceId: string; initialFocus?: { source: string; sessionId: string }; onSignedOut?: () => void };

/** Do not mount list/catalog/replay readers before the runtime gate is enabled. */
export function GraphPage(props: Props) {
  return sessionVisualizationsEnabled() ? <EnabledGraph {...props} /> : <ButtonLink href={listHref()} onClick={onLinkClick}>Back to sessions</ButtonLink>;
}
function EnabledGraph(props: Props) {
  const { onSignedOut } = props;
  const [now] = useState(() => Date.now());
  const detail = useCallback(async (...args: Parameters<typeof loadGraphDetail>) => {
    try { return await loadGraphDetail(...args); }
    catch (error) { if (error instanceof SignedOut) onSignedOut?.(); throw error; }
  }, [onSignedOut]);
  const relationships = useCallback(async (...args: Parameters<typeof loadGraphRelationships>) => {
    try { return await loadGraphRelationships(...args); }
    catch (error) { if (error instanceof SignedOut) onSignedOut?.(); throw error; }
  }, [onSignedOut]);
  return <SessionsGraph {...props} initialNow={now} loadDetail={detail} loadRelationships={relationships} />;
}
