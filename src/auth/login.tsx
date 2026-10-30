import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  LoaderCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { CloudClient } from "@/api/client";
import type { Device } from "@/api/contracts";

export function Login({ client }: { client: CloudClient }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function login() {
    controller.current?.abort();
    const attempt = new AbortController();
    controller.current = attempt;
    setError(null);
    setBusy(true);
    try {
      const pending = await client.startLogin(attempt.signal);
      if (attempt.signal.aborted) return;
      setDevice(pending);
      await client.finishLogin(pending, attempt.signal);
    } catch (error) {
      if (!attempt.signal.aborted) {
        setError(
          error instanceof Error ? error.message : "Sign-in failed. Try again.",
        );
        setDevice(null);
      }
    } finally {
      if (!attempt.signal.aborted) setBusy(false);
    }
  }
  function cancel() {
    controller.current?.abort();
    setDevice(null);
    setBusy(false);
    setError(null);
  }
  return (
    <div className="login-page">
      <a className="brand" href={client.cloudOrigin}>
        <img src="/mark.svg" alt="" /> <span>Agent Relay</span>
      </a>
      <div className="login-layout">
        <section className="login-story">
          <p className="eyebrow">Your workspace, together</p>
          <h1>
            Pick up where
            <br />
            your agents left off.
          </h1>
          <p>
            One place for the work happening across your tools. Find a session,
            see what changed, and keep moving.
          </p>
          <div className="story-foot">
            <span className="little-line" /> Built for the way you work.
          </div>
        </section>
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-icon">
            <img src="/mark.svg" alt="" />
          </div>
          <h2 id="login-title">
            {device ? "Approve your sign-in" : "Welcome to your dashboard"}
          </h2>
          <p>
            {device
              ? "Open Agent Relay and confirm that this code matches. This page will continue automatically."
              : "Sign in with your Agent Relay account to see your cloud sessions."}
          </p>
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Couldn’t sign in</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {device ? (
            <>
              <div className="verification-code" aria-label="Sign-in code">
                {device.user_code}
              </div>
              <Button asChild size="lg">
                <a
                  href={device.verification_uri_complete}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Approve sign-in <ArrowUpRight data-icon="inline-end" />
                </a>
              </Button>
              <div role="status" className="waiting">
                <LoaderCircle className="spin" /> Waiting for approval
              </div>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </>
          ) : (
            <Button size="lg" disabled={busy} onClick={() => void login()}>
              {busy ? (
                <LoaderCircle className="spin" data-icon="inline-start" />
              ) : null}
              {busy ? "Starting sign-in…" : "Continue with Agent Relay"}
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
          <div className="login-note">
            <ShieldCheck />
            <span>
              Your account stays with Agent Relay.
              <br />
              No password is shared with this dashboard.
            </span>
          </div>
        </section>
      </div>
      <p className="session-note">
        For this preview release, sign-in lasts until this tab is reloaded.
        Credentials are kept in memory.
      </p>
      <footer className="login-footer">
        <span>Agent Relay Dashboard</span>
        <a href="https://github.com/AgentWorkforce/relay-dashboard">
          Open source <ArrowUpRight />
        </a>
      </footer>
    </div>
  );
}
