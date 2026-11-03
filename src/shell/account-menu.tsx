// Ported from hosted Cloud (app/dashboard/_components/workspace-switcher.tsx).
// Self-host differences: relaycontrol signs a person into one workspace and
// has no workspace switch, create, or sign-out endpoint, so the menu lists the
// current workspace and links to its settings; the Radix dropdown is a small
// disclosure menu with the same classes.
import { useEffect, useId, useRef, useState } from "react";
import { Check, Settings2, Users2 } from "lucide-react";
import styles from "./workspace-switcher.module.css";

export function initials(name: string | null | undefined) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/** Hosted Avatar fallback: round, muted, initials. */
export function InitialsAvatar({
  name,
  size = 32,
  className,
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  return (
    <span
      data-slot="avatar"
      className={`relative flex shrink-0 overflow-hidden rounded-full select-none ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <span
        data-slot="avatar-fallback"
        className="flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground"
        style={size < 28 ? { fontSize: 10 } : undefined}
      >
        {initials(name)}
      </span>
    </span>
  );
}

export function AccountMenu({
  userName,
  workspaceName,
}: {
  userName: string;
  workspaceName: string | null;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const workspace = workspaceName ?? "No workspace";
  return (
    <div ref={root} className="relative w-full min-w-0">
      <button
        type="button"
        ref={trigger}
        data-account-trigger
        className={styles.trigger}
        aria-label={`Account and workspaces: ${userName}`}
        title={userName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-state={open ? "open" : "closed"}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.triggerUser}>
          <InitialsAvatar name={userName} className={styles.triggerAvatar} />
        </span>
        <span className={styles.triggerIdentity} data-account-identity>
          <strong>{userName}</strong>
          <small>{workspace}</small>
        </span>
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Account and workspaces"
          className={`${styles.menu} absolute bottom-0 left-full z-50 ml-3 border`}
        >
          <div className={styles.account}>
            <InitialsAvatar name={userName} className={styles.accountAvatar} />
            <span className={styles.identity}>
              <strong>{userName}</strong>
            </span>
          </div>
          <div role="separator" className={`${styles.separator} h-px`} />
          <p className={styles.heading}>Workspaces</p>
          <div
            role="menuitem"
            aria-current="true"
            className={`${styles.item} flex items-center text-sm`}
            data-current="true"
          >
            <InitialsAvatar name={workspace} size={28} />
            <span className={styles.identity}>
              <strong>{workspace}</strong>
            </span>
            <Check size={16} aria-label="Current workspace" />
          </div>
          <div role="separator" className={`${styles.separator} h-px`} />
          <a
            role="menuitem"
            href="#/settings/members"
            className={`${styles.item} flex items-center text-sm`}
            onClick={() => setOpen(false)}
          >
            <Users2 size={18} aria-hidden="true" />
            Members
          </a>
          <a
            role="menuitem"
            href="#/settings/workspace"
            className={`${styles.item} flex items-center text-sm`}
            onClick={() => setOpen(false)}
          >
            <Settings2 size={18} aria-hidden="true" />
            Manage workspace
          </a>
        </div>
      )}
    </div>
  );
}
