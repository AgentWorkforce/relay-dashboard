import { useState, type FormEvent } from "react";
import { adminApi } from "./api";
import type { Role } from "./contracts";
import { message, useLoad } from "./use-load";

const ROLES: Role[] = ["member", "admin", "owner"];

export function MembersSection(props: {
  organizationId: string;
  currentUserId: string;
  canManage: boolean;
  /** Membership changes can change the viewer's own role and permissions. */
  onChanged: () => void;
}) {
  const { data, error, reload } = useLoad((signal) =>
    adminApi.members(props.organizationId, signal),
  );
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setFailure(null);
    try {
      await action();
      reload();
      props.onChanged();
    } catch (error) {
      setFailure(message(error));
    } finally {
      setBusy(false);
    }
  }

  function add(event: FormEvent) {
    event.preventDefault();
    if (!email.trim() || !name.trim()) {
      setFailure("Enter an email and a name.");
      return;
    }
    void run(async () => {
      await adminApi.putMember(props.organizationId, {
        email: email.trim(),
        name: name.trim(),
        role,
      });
      setEmail("");
      setName("");
      setRole("member");
    });
  }

  return (
    <section aria-labelledby="members-title" className="card">
      <h2 id="members-title">Members</h2>
      <p>
        People in this organization. Members can view settings; owners and
        admins manage them. New members sign in with a device code at /login.
      </p>
      {props.canManage && (
        <form className="inline-form" onSubmit={add}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </label>
          <label>
            Role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as Role)}
            >
              {ROLES.map((item) => (
                <option key={item} value={item}>
                  {item[0]!.toUpperCase() + item.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            type="submit"
            disabled={busy || !email.trim() || !name.trim()}
          >
            Add member
          </button>
        </form>
      )}
      {failure && <p role="alert">{failure}</p>}
      {error && <p role="alert">{message(error)}</p>}
      {data && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              {props.canManage && <th aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {data.map((member) => (
              <tr key={member.userId}>
                <td>
                  {member.name}
                  {member.userId === props.currentUserId && " (you)"}
                </td>
                <td>{member.email}</td>
                <td>
                  {props.canManage ? (
                    <select
                      aria-label={`Role for ${member.email}`}
                      value={member.role}
                      disabled={busy}
                      onChange={(event) =>
                        void run(() =>
                          adminApi.putMember(props.organizationId, {
                            email: member.email,
                            name: member.name,
                            role: event.target.value as Role,
                          }),
                        )
                      }
                    >
                      {ROLES.map((item) => (
                        <option key={item} value={item}>
                          {item[0]!.toUpperCase() + item.slice(1)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge">{member.role}</span>
                  )}
                </td>
                {props.canManage && (
                  <td className="actions">
                    {member.userId !== props.currentUserId && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Remove ${member.name} (${member.email}) from this organization?`,
                            )
                          )
                            return;
                          void run(() =>
                            adminApi.removeMember(
                              props.organizationId,
                              member.userId,
                            ),
                          );
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
