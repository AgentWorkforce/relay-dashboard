import { useEffect, useRef, useState, type FormEvent } from "react";
import { SignedOut } from "../../api/client";
import {
  flowsApi,
  type Enrollment,
  type EnrollmentToken,
  type Worker,
} from "../api";
import { Badge, CopyableCommand, Tile, Time } from "../components";
import {
  fullTime,
  go,
  seg,
  shellQuote,
  statusLabel,
  usePolling,
  workerTone,
} from "../format";

function hostSummary(worker: Worker): string {
  const info = worker.hostInfo;
  const pick = (...keys: string[]) =>
    keys.map((key) => info[key]).find((value) => typeof value === "string") as
      string | undefined;
  return (
    [
      pick("os", "platform", "operatingSystem"),
      pick("arch", "architecture"),
      pick("agentRelayVersion", "cliVersion", "version", "node"),
    ]
      .filter(Boolean)
      .join(" / ") || "—"
  );
}

export function WorkerBadge({ status }: { status: string }) {
  return <Badge tone={workerTone(status)}>{statusLabel(status)}</Badge>;
}

export function WorkersPage({
  onError,
}: {
  onError: (error: Error | null) => void;
}) {
  const [workers, setWorkers] = useState<Worker[] | null>(null);
  const [tokens, setTokens] = useState<EnrollmentToken[] | null>(null);
  // Write controls appear only once the enrollment listing (admin-only)
  // has succeeded.
  const [canAdmin, setCanAdmin] = useState(false);
  // Once enrollment listing is denied, stop asking on every poll.
  const enrollmentsDenied = useRef(false);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  usePolling(
    async (signal) => {
      try {
        const next = await flowsApi.listWorkers(signal);
        if (signal.aborted) return;
        setWorkers(next);
        onError(null);
        if (enrollmentsDenied.current) return;
        try {
          setTokens(await flowsApi.listEnrollments(signal));
          setCanAdmin(true);
        } catch (error) {
          if ((error as { status?: number }).status === 403) {
            enrollmentsDenied.current = true;
            setCanAdmin(false);
          } else if (!signal.aborted) onError(error as Error);
        }
      } catch (error) {
        if (!signal.aborted) onError(error as Error);
      }
    },
    10_000,
    true,
    [revision],
  );

  async function revoke(worker: Worker) {
    if (
      !window.confirm(
        `Revoke ${worker.name}? This worker will stop receiving new work.`,
      )
    )
      return;
    try {
      await flowsApi.revokeWorker(worker.id);
      setNotice(`${worker.name} was revoked.`);
      setRevision((value) => value + 1);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function revokeToken(token: EnrollmentToken) {
    if (
      !window.confirm(
        `Revoke enrollment token ${token.tokenHint}? It can no longer register a worker.`,
      )
    )
      return;
    try {
      await flowsApi.revokeEnrollment(token.id);
      setNotice(`Enrollment token ${token.tokenHint} was revoked.`);
      setRevision((value) => value + 1);
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  return (
    <>
      <div className="heading">
        <div>
          <h1>Workers</h1>
          <p>
            Register self-hosted machines or the relayflows Helm chart to run
            your flows.
          </p>
        </div>
        {canAdmin && (
          <a className="button primary" href="#/flows/workers/new">
            Add worker
          </a>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {!workers && <p role="status">Loading workers…</p>}
      {workers && workers.length === 0 && (
        <div className="empty">
          <strong>No workers registered yet.</strong>
          <p>
            Create an enrollment token and run the generated commands on a host.
          </p>
        </div>
      )}
      {workers && workers.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Last seen</th>
              <th>OS / arch / version</th>
              <th>Current run</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {workers.map((worker) => (
              <tr key={worker.id}>
                <td>
                  <a href={`#/flows/workers/${seg(worker.id)}`}>
                    <strong>{worker.name}</strong>
                  </a>
                </td>
                <td>
                  <WorkerBadge status={worker.status} />
                </td>
                <td>
                  {worker.tags.length ? (
                    worker.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
                  ) : (
                    <span className="muted">None</span>
                  )}
                </td>
                <td>
                  {worker.lastSeen ? <Time value={worker.lastSeen} /> : "Never"}
                </td>
                <td>{hostSummary(worker)}</td>
                <td>
                  {worker.currentRunId ? (
                    <a href={`#/flows/runs/${seg(worker.currentRunId)}`}>
                      {worker.currentRunId.slice(0, 8)}
                    </a>
                  ) : (
                    <span className="muted">Idle</span>
                  )}
                </td>
                <td className="actions">
                  <a href={`#/flows/workers/${seg(worker.id)}`}>View</a>
                  {canAdmin && (
                    <button
                      className="danger ghost"
                      disabled={worker.status === "revoked"}
                      onClick={() => void revoke(worker)}
                    >
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {canAdmin && tokens && tokens.length > 0 && (
        <details className="panel">
          <summary>
            Enrollment tokens (
            {tokens.filter((token) => token.status === "active").length} active)
          </summary>
          <table className="table">
            <thead>
              <tr>
                <th>Token</th>
                <th>Worker name</th>
                <th>Status</th>
                <th>Expires</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={token.id}>
                  <td className="mono">{token.tokenHint}</td>
                  <td>{token.name ?? "—"}</td>
                  <td>
                    <Badge
                      tone={token.status === "active" ? "info" : "default"}
                    >
                      {statusLabel(token.status)}
                    </Badge>
                  </td>
                  <td title={fullTime(token.expiresAt)}>
                    <Time value={token.expiresAt} />
                  </td>
                  <td className="actions">
                    {token.status === "active" && (
                      <button
                        className="danger ghost"
                        onClick={() => void revokeToken(token)}
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}

export function AddWorkerPage({
  onError,
}: {
  onError: (error: Error | null) => void;
}) {
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [expires, setExpires] = useState("60");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<
    (Enrollment & { name: string }) | null
  >(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await flowsApi.createEnrollment({
        name: name.trim(),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        expiresInMinutes: Number(expires),
      });
      setEnrollment({ ...created, name: name.trim() });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (enrollment)
    return <EnrollmentSuccess enrollment={enrollment} onError={onError} />;
  return (
    <>
      <div className="heading">
        <div>
          <a className="back" href="#/flows/workers">
            ← Back to workers
          </a>
          <h1>Add worker</h1>
          <p>
            Create a single-use enrollment token, then run the generated
            commands on the host.
          </p>
        </div>
      </div>
      <form className="form" onSubmit={(event) => void submit(event)}>
        <label>
          Worker name
          <input
            required
            maxLength={128}
            placeholder="relayflows-worker"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Tags
          <input
            placeholder="linux, gpu"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
          />
          <small>
            Runs that require tags only go to workers that carry all of them.
          </small>
        </label>
        <label>
          Token lifetime
          <select
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          >
            <option value="15">15 minutes</option>
            <option value="60">1 hour</option>
            <option value="1440">1 day</option>
            <option value="10080">7 days (for a Helm rollout)</option>
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="form-actions">
          <button
            className="primary"
            type="submit"
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create enrollment token"}
          </button>
        </div>
      </form>
    </>
  );
}

function EnrollmentSuccess({
  enrollment,
  onError,
}: {
  enrollment: Enrollment & { name: string };
  onError: (error: Error | null) => void;
}) {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  // Bumped by "Keep waiting" to restart the 5-minute watch (Helm rollouts can
  // take longer; the token stays valid until it expires).
  const [watch, setWatch] = useState(0);
  const issuedAt = Date.parse(enrollment.createdAt);
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 5 * 60_000);
    return () => clearTimeout(timer);
  }, [watch]);
  usePolling(
    async (signal) => {
      let workers: Worker[];
      try {
        workers = await flowsApi.listWorkers(signal);
      } catch (error) {
        // An expired session must reach the app's sign-in redirect; other
        // failures are retried on the next poll.
        if (!signal.aborted && error instanceof SignedOut) onError(error);
        return;
      }
      if (signal.aborted) return;
      setWorker(
        workers.find(
          (candidate) =>
            candidate.name === enrollment.name &&
            Date.parse(candidate.registeredAt) >= issuedAt - 5_000,
        ) ?? null,
      );
    },
    3_000,
    !timedOut && worker?.status !== "online",
    [watch],
  );
  const helm = `relayflows:
  mode: cloudWorker
  worker:
    name: ${JSON.stringify(enrollment.name)}
    cloudUrl: ${JSON.stringify(enrollment.cloudUrl)}
  credentials:
    existingSecret: relayflows-worker-enrollment   # key AGENT_RELAY_WORKER_ENROLLMENT_TOKEN`;
  return (
    <>
      <div className="heading">
        <div>
          <a className="back" href="#/flows/workers">
            ← Back to workers
          </a>
          <h1>Enroll {enrollment.name}</h1>
        </div>
        <Badge tone="warning">Expires {fullTime(enrollment.expiresAt)}</Badge>
      </div>
      <p className="warning-banner" role="note">
        This token is shown only once — copy it now.
      </p>
      <section className="panel">
        <h2>Run these commands on the worker host</h2>
        <CopyableCommand label="Enrollment token" command={enrollment.token} />
        <CopyableCommand
          label="Register worker"
          command={enrollment.registerCommand}
        />
        <CopyableCommand
          label="Start worker"
          command={enrollment.startCommand}
        />
        <h3>Or deploy the relayflows Helm chart</h3>
        <CopyableCommand
          label="Create the enrollment Secret"
          command={`kubectl create secret generic relayflows-worker-enrollment --from-literal=AGENT_RELAY_WORKER_ENROLLMENT_TOKEN=${enrollment.token}`}
        />
        <CopyableCommand label="values.yaml" command={helm} />
      </section>
      <section className="panel" aria-label="Registration status">
        <h2>Registration status</h2>
        {!worker && !timedOut && <p role="status">Waiting for registration…</p>}
        {!worker && timedOut && (
          <p role="alert">
            Timed out waiting for this worker. The token stays valid until it
            expires.{" "}
            <button
              type="button"
              onClick={() => {
                setTimedOut(false);
                setWatch((value) => value + 1);
              }}
            >
              Keep waiting
            </button>
          </p>
        )}
        {worker && worker.status !== "online" && (
          <p role="status">
            <WorkerBadge status={worker.status} /> Registered. Start the worker
            command to bring it online.
          </p>
        )}
        {worker?.status === "online" && (
          <p role="status">
            <WorkerBadge status="online" /> Online. The worker is ready to run
            flows.{" "}
            <a href={`#/flows/workers/${seg(worker.id)}`}>View worker →</a>
          </p>
        )}
      </section>
    </>
  );
}

export function WorkerDetailPage({
  workerId,
  onError,
}: {
  workerId: string;
  onError: (error: Error | null) => void;
}) {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [missing, setMissing] = useState(false);
  // Same permission probe as the workers list: enrollment tokens are
  // admin-only, so only show Revoke when listing them succeeds.
  const [canAdmin, setCanAdmin] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    flowsApi.listEnrollments(controller.signal).then(
      () => {
        if (!controller.signal.aborted) setCanAdmin(true);
      },
      () => undefined,
    );
    return () => controller.abort();
  }, []);
  usePolling(
    async (signal) => {
      try {
        const next = await flowsApi.getWorker(workerId, signal);
        if (!signal.aborted) {
          setWorker(next);
          onError(null);
        }
      } catch (error) {
        if (signal.aborted) return;
        if ((error as { status?: number }).status === 404) setMissing(true);
        else onError(error as Error);
      }
    },
    10_000,
    !missing,
    [workerId],
  );
  if (missing) {
    return (
      <div className="empty">
        <strong>Worker not found</strong>
        <a className="button" href="#/flows/workers">
          Back to workers
        </a>
      </div>
    );
  }
  if (!worker) return <p role="status">Loading worker…</p>;
  return (
    <>
      <div className="heading">
        <div>
          <a className="back" href="#/flows/workers">
            ← Back to workers
          </a>
          <h1>{worker.displayName}</h1>
        </div>
        <WorkerBadge status={worker.status} />
      </div>
      <dl className="tiles">
        <Tile label="Name">{worker.name}</Tile>
        <Tile label="Registered">{fullTime(worker.registeredAt)}</Tile>
        <Tile label="Last seen">
          {worker.lastSeen ? fullTime(worker.lastSeen) : "Never"}
        </Tile>
        <Tile label="Registered by">{worker.registeredBy ?? "—"}</Tile>
        <Tile label="Tags">{worker.tags.join(", ") || "None"}</Tile>
        <Tile label="Current run">
          {worker.currentRunId ? (
            <a href={`#/flows/runs/${seg(worker.currentRunId)}`}>
              {worker.currentRunId.slice(0, 8)}
            </a>
          ) : (
            "Idle"
          )}
        </Tile>
      </dl>
      <section className="panel">
        <h2>Host info</h2>
        <pre>{JSON.stringify(worker.hostInfo, null, 2)}</pre>
      </section>
      <section className="panel">
        <h2>Local diagnostics</h2>
        <CopyableCommand
          label="Status"
          command={`agent-relay cloud worker status --name ${shellQuote(worker.name)}`}
        />
        <CopyableCommand
          label="Logs"
          command={`agent-relay cloud worker logs --name ${shellQuote(worker.name)} --follow`}
        />
      </section>
      {canAdmin && worker.status !== "revoked" && (
        <section className="panel danger-zone">
          <h2>Danger zone</h2>
          <p>
            Revoking invalidates the worker token, fails its active work, and
            stops new assignments.
          </p>
          <button
            className="danger"
            onClick={() => {
              if (
                !window.confirm(
                  `Revoke ${worker.name}? This worker will stop receiving new work.`,
                )
              )
                return;
              void flowsApi.revokeWorker(worker.id).then(
                () => go("/flows/workers"),
                (error: Error) => onError(error),
              );
            }}
          >
            Revoke worker
          </button>
        </section>
      )}
    </>
  );
}
