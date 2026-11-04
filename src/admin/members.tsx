// Hosted Cloud's OrganizationMembersCard + InviteMemberDialog
// (packages/web/app/dashboard/_components/organization-members-card.tsx),
// on the self-host invitations API. Differences from hosted: an `admin` role
// (owners and admins invite; only owners manage owners) and links that are
// shown once, so "Copy link" issues a fresh one.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { adminApi } from "./api";
import type {
  EmailDelivery,
  Invitation,
  Member,
  Role,
  SignInMethods,
} from "./contracts";
import { formatDate, message, useLoad } from "./use-load";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "../shell/ui";

const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

const selectClass =
  "rounded-full border border-[var(--border-default)] bg-[var(--surface-soft)] px-3 py-1.5 text-xs text-foreground disabled:opacity-50";

function initials(member: { name?: string | null; email: string }) {
  const source = (member.name || member.email).trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Roles the viewer may hand out: only owners grant owner. */
function assignable(viewer: Role): Role[] {
  return viewer === "owner" ? ["member", "admin", "owner"] : ["member", "admin"];
}

type LinkNotice = {
  inviteId: string;
  email: string;
  url: string;
  delivery: EmailDelivery;
  /** Set when the link was copied for the viewer. */
  copied: boolean | "unavailable";
  rotated: boolean;
};

async function copyText(value: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function deliveryText(notice: LinkNotice): string {
  if (notice.rotated && notice.delivery === "skipped") {
    return notice.copied === true
      ? `A new invite link for ${notice.email} was copied. Earlier links for this invite no longer work.`
      : `New invite link for ${notice.email}. Earlier links for this invite no longer work.`;
  }
  switch (notice.delivery) {
    case "sent":
      return `Invitation emailed to ${notice.email}.`;
    case "failed":
      return "Invite created, but the email could not be sent. Copy the link below and send it yourself.";
    case "not_configured":
      return "Email delivery is not configured for this installation. Copy the link below and send it yourself.";
    default:
      return "Invite created, but delivery could not be confirmed. Copy the link below and send it yourself.";
  }
}

export function MembersSection(props: {
  organizationId: string;
  organizationName: string;
  currentUserId: string;
  viewerRole: Role;
  canManage: boolean;
  /** Membership changes can change the viewer's own role and permissions. */
  onChanged: () => void;
}) {
  const members = useLoad((signal) =>
    adminApi.members(props.organizationId, signal),
  );
  const canInvite = props.canManage;
  const invites = useLoad((signal) =>
    canInvite
      ? adminApi.invitations(props.organizationId, signal)
      : Promise.resolve([] as Invitation[]),
  );
  const methods = useLoad<SignInMethods | null>((signal) =>
    adminApi.signInMethods(signal).catch(() => null),
  );
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [notice, setNotice] = useState<LinkNotice | null>(null);

  async function run(action: () => Promise<unknown>, changesViewer = false) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      members.reload();
      if (canInvite) invites.reload();
      if (changesViewer) props.onChanged();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  function changeRole(member: Member, role: Role) {
    void run(
      () =>
        adminApi.putMember(props.organizationId, {
          email: member.email,
          name: member.name,
          role,
        }),
      true,
    );
  }

  function remove(member: Member) {
    if (
      !window.confirm(
        `Remove ${member.name || member.email} (${member.email}) from ${props.organizationName}?`,
      )
    )
      return;
    void run(() => adminApi.removeMember(props.organizationId, member.userId), true);
  }

  function newLink(invite: Invitation, send: boolean) {
    void run(async () => {
      const result = await adminApi.inviteLink(props.organizationId, invite.id, send);
      const copied = send ? false : await copyText(result.inviteUrl);
      setNotice({
        inviteId: invite.id,
        email: invite.email,
        url: result.inviteUrl,
        delivery: result.emailDelivery,
        copied: send ? false : copied ? true : "unavailable",
        rotated: true,
      });
    });
  }

  function cancel(invite: Invitation) {
    void run(async () => {
      await adminApi.revokeInvite(props.organizationId, invite.id);
      if (notice?.inviteId === invite.id) setNotice(null);
    });
  }

  /** An admin may not change, or remove, an owner. */
  const mayManage = (member: Member) =>
    props.canManage && (props.viewerRole === "owner" || member.role !== "owner");

  const pending = invites.data ?? [];
  const loadError = members.error ?? (canInvite ? invites.error : null);

  return (
    <Card aria-labelledby="members-title">
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle id="members-title">Organization access</CardTitle>
            <CardDescription>
              Manage membership and roles in {props.organizationName}.
            </CardDescription>
            {!canInvite && (
              <p className="mt-2 text-sm text-muted-foreground">
                Only an owner or admin of {props.organizationName} can send
                invites — ask one to invite your teammates.
              </p>
            )}
          </div>
          {canInvite && (
            <Button onClick={() => setDialogOpen(true)} disabled={busy}>
              Invite member
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {(failure || loadError) && (
          <p
            role="alert"
            className="rounded-md border border-[var(--status-danger)] bg-[var(--status-danger-soft)] p-3 text-sm text-[var(--status-danger)]"
          >
            {failure ?? message(loadError)}
          </p>
        )}
        {!members.data && !members.error && (
          <p className="text-sm text-muted-foreground" role="status">
            Loading members…
          </p>
        )}
        {members.data && members.data.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No active members found for this organization.
          </p>
        )}
        {members.data && members.data.length > 0 && (
          <ul
            className="flex flex-col divide-y divide-[var(--border-default)]"
            aria-label="Members"
          >
            {members.data.map((member) => {
              const isMe = member.userId === props.currentUserId;
              const manageable = mayManage(member);
              return (
                <li
                  key={member.userId}
                  className="flex flex-col gap-2 py-3"
                  data-testid={`member-${member.email}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--surface-strong)] text-xs font-semibold"
                      >
                        {initials(member)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {member.name || member.email || "Unknown user"}
                          {isMe && " (you)"}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {member.email}
                          {member.joinedAt ? ` • joined ${formatDate(member.joinedAt)}` : ""}
                        </p>
                      </div>
                    </div>
                    {manageable ? (
                      <div className="flex shrink-0 items-center gap-2">
                        <select
                          aria-label={`Role for ${member.email}`}
                          className={selectClass}
                          value={member.role}
                          disabled={busy}
                          onChange={(event) =>
                            changeRole(member, event.target.value as Role)
                          }
                        >
                          {assignable(props.viewerRole).map((item) => (
                            <option key={item} value={item}>
                              {ROLE_LABEL[item]}
                            </option>
                          ))}
                        </select>
                        {!isMe && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[var(--text-secondary)] hover:text-[var(--status-danger)]"
                            disabled={busy}
                            onClick={() => remove(member)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Badge>{ROLE_LABEL[member.role]}</Badge>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {canInvite && (
          <div className="flex flex-col gap-3">
            {notice && <InviteNotice key={notice.url} notice={notice} />}
            <p className="text-sm font-medium">Pending invitations</p>
            {invites.data && pending.length === 0 && (
              <p className="text-sm text-muted-foreground">No pending invitations.</p>
            )}
            {pending.length > 0 && (
              <ul
                className="flex flex-col divide-y divide-[var(--border-default)]"
                aria-label="Pending invitations"
              >
                {pending.map((invite) => {
                  const manageable =
                    props.viewerRole === "owner" || invite.role !== "owner";
                  return (
                    <li
                      key={invite.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                      data-testid={`invite-${invite.email}`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{invite.email}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {ROLE_LABEL[invite.role].toLowerCase()} • invited by{" "}
                          {invite.invitedBy?.name || invite.invitedBy?.email || "an administrator"} •{" "}
                          {invite.status === "expired"
                            ? `expired ${formatDate(invite.expiresAt)}`
                            : `expires ${formatDate(invite.expiresAt)}`}
                        </p>
                      </div>
                      {manageable && (
                        <div className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            title="Creates a fresh link; earlier links for this invite stop working."
                            onClick={() => newLink(invite, false)}
                          >
                            {notice?.inviteId === invite.id && notice.copied === true
                              ? "Copied"
                              : "Copy link"}
                          </Button>
                          {methods.data?.inviteEmail && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => newLink(invite, true)}
                            >
                              Resend
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-[var(--text-secondary)] hover:text-[var(--status-danger)]"
                            disabled={busy}
                            onClick={() => cancel(invite)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </CardContent>
      {dialogOpen && (
        <InviteMemberDialog
          organizationId={props.organizationId}
          organizationName={props.organizationName}
          viewerRole={props.viewerRole}
          methods={methods.data ?? null}
          onClose={() => setDialogOpen(false)}
          onInvited={(result) => {
            setDialogOpen(false);
            setNotice({
              inviteId: result.invitation.id,
              email: result.invitation.email,
              url: result.inviteUrl,
              delivery: result.emailDelivery,
              copied: false,
              rotated: false,
            });
            invites.reload();
          }}
        />
      )}
    </Card>
  );
}

function InviteNotice({ notice }: { notice: LinkNotice }) {
  const sent = notice.delivery === "sent";
  // Keyed by the link: a new link starts with its own copied state.
  const [copied, setCopied] = useState<boolean | "unavailable">(notice.copied);
  return (
    <div
      role="status"
      className={
        sent
          ? "flex flex-col gap-2 rounded-md border border-[var(--status-success)] bg-[var(--status-success-soft)] p-3 text-sm"
          : "flex flex-col gap-2 rounded-md border border-[var(--status-warning)] bg-[var(--status-warning-soft)] p-3 text-sm"
      }
    >
      <p>{deliveryText(notice)}</p>
      <div className="flex flex-col gap-2 rounded-md border border-[var(--border-default)] bg-[var(--surface-soft)] p-2">
        <p className="text-xs text-muted-foreground">
          {copied === "unavailable"
            ? "Clipboard unavailable — select and copy this link:"
            : "Invite link (works once):"}
        </p>
        <code className="break-all font-mono text-xs">{notice.url}</code>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => setCopied((await copyText(notice.url)) ? true : "unavailable")}
          >
            {copied === true ? "Copied" : "Copy link"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function InviteMemberDialog(props: {
  organizationId: string;
  organizationName: string;
  viewerRole: Role;
  methods: SignInMethods | null;
  onClose: () => void;
  onInvited: (result: Awaited<ReturnType<typeof adminApi.invite>>) => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      props.onInvited(
        await adminApi.invite(props.organizationId, { email: email.trim(), role }),
      );
    } catch (failure) {
      setError(message(failure) || "Failed to send invite");
    } finally {
      setSending(false);
    }
  }

  const methods = props.methods;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close invite dialog"
        className="absolute inset-0 bg-[var(--overlay)] backdrop-blur-sm"
        onClick={props.onClose}
      />
      <Card
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-title"
        className="relative w-full max-w-lg"
      >
        <CardHeader className="bg-[var(--surface-strong)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle id="invite-title">Invite members</CardTitle>
              <CardDescription>
                Invite people to {props.organizationName} by email.
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={props.onClose}>
              Close
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3 pt-4" onSubmit={submit}>
            <label className="flex flex-col gap-1 text-sm">
              Email
              <Input
                ref={input}
                type="email"
                required
                placeholder="colleague@example.com"
                className="rounded-full"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Role
              <select
                aria-label="Role"
                className={selectClass}
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
              >
                {assignable(props.viewerRole).map((item) => (
                  <option key={item} value={item}>
                    {ROLE_LABEL[item]}
                  </option>
                ))}
              </select>
            </label>
            {methods && (
              <p className="text-xs text-muted-foreground">
                {methods.inviteEmail
                  ? "We'll email the invite link. "
                  : "Email isn't configured here, so you'll copy the link and send it yourself. "}
                {methods.oidc
                  ? `They sign in with ${methods.oidc.displayName} using the invited email.`
                  : methods.emailLink
                    ? "They sign in with an emailed link sent to the invited address."
                    : "No sign-in method is configured yet; ask your operator to set up single sign-on."}
                {` The link works once and expires in ${
                  methods.inviteTtlHours % 24 === 0
                    ? `${methods.inviteTtlHours / 24} day${methods.inviteTtlHours === 24 ? "" : "s"}`
                    : `${methods.inviteTtlHours} hours`
                }.`}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-[var(--status-danger)]">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={sending || !email.trim()}>
              {sending ? "Sending..." : "Send invitation"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
