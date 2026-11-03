// The hosted dashboard frame (DashboardShell): the workspace chrome with the
// signed-in account in the sidebar. Pages keep their own data loading and
// sign-in redirects; the shell only reads the account for display.
import { useEffect, useState, type ReactNode } from "react";
import { getAccount } from "../api/client";
import type { Account } from "../api/contracts";
import { AccountMenu } from "./account-menu";
import { WorkspaceChrome, type RailSection } from "./workspace-chrome";

export function Shell({
  rail,
  label,
  children,
}: {
  rail: RailSection;
  label: string;
  children: ReactNode;
}) {
  const [account, setAccount] = useState<Account | null>(null);
  useEffect(() => {
    const request = new AbortController();
    getAccount(request.signal).then(
      (value) => {
        if (!request.signal.aborted) setAccount(value);
      },
      () => {
        /* Pages report sign-in and load failures themselves. */
      },
    );
    return () => request.abort();
  }, []);
  const userName = account?.user.name || "Your account";
  return (
    <WorkspaceChrome
      rail={rail}
      label={label}
      workspaceName={account?.currentWorkspace?.name}
      accountControl={
        account ? (
          <AccountMenu
            userName={userName}
            workspaceName={account.currentWorkspace?.name ?? null}
          />
        ) : null
      }
    >
      {children}
    </WorkspaceChrome>
  );
}
