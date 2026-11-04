import { ExternalLink } from "lucide-react";
import type { AdminContext } from "./contracts";
import { CopyField } from "./copy-field";
import { desktopConnectLink, desktopLinks, type DesktopLinks } from "../shell/desktop-links";
import { ButtonLink } from "../shell/ui";

/**
 * Hosted connect-agent.tsx's launch step: open Agent Relay Desktop signed in
 * to this deployment, this account and this workspace. Nothing without a
 * runtime config (the hosted build has its own Connect agent dialog).
 */
export function DesktopSection(props: {
  context: AdminContext;
  links?: DesktopLinks | null;
}) {
  const links = props.links === undefined ? desktopLinks() : props.links;
  if (!links) return null;
  const href = desktopConnectLink(links, props.context.user.id, props.context.currentWorkspace.id);
  return (
    <section aria-labelledby="desktop-title" className="card">
      <h2 id="desktop-title">Connect your agents</h2>
      <p>Relay Desktop connects agents on your computer to this workspace.</p>
      {href ? (
        <>
          <p>
            <ButtonLink href={href}>
              <ExternalLink size={14} aria-hidden="true" />
              Open Agent Relay Desktop
            </ButtonLink>
          </p>
          <dl className="facts">
            <dt>Desktop link</dt>
            <dd>
              <CopyField value={href} label="Desktop link" />
            </dd>
            <dt>Site</dt>
            <dd>
              <code>{links.site}</code>
            </dd>
          </dl>
        </>
      ) : (
        <p>Desktop connection is unavailable on this deployment.</p>
      )}
    </section>
  );
}
