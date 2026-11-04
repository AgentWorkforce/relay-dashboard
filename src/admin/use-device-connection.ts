// Port of AgentWorkforce/cloud packages/web/hooks/use-openai-device-connection.ts,
// generalised to the two device logins self-host offers (Codex via OpenAI,
// Grok via xAI). Start a device authorization, show the one-time code, then
// poll until relaycontrol has stored the login.
import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi } from "./api";
import { message } from "./use-load";

export type DeviceProvider = "openai" | "xai";
export type DeviceConnectionState = "idle" | "starting" | "waiting" | "connected";

export type DeviceConnection = {
  transactionId: string;
  verificationUri: string;
  userCode: string;
  intervalSeconds: number;
  expiresAt: string;
};

export function useDeviceConnection({
  workspaceId,
  provider,
  label,
  onConnected,
}: {
  workspaceId: string | null;
  provider: DeviceProvider;
  label: string;
  onConnected?: () => void;
}) {
  const [connection, setConnection] = useState<DeviceConnection | null>(null);
  const [state, setState] = useState<DeviceConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Held in a ref so callers can pass an inline closure without restarting the
  // poll loop below on every render.
  const onConnectedRef = useRef(onConnected);
  useEffect(() => {
    onConnectedRef.current = onConnected;
  }, [onConnected]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    setConnection(null);
    setState("idle");
    setError(null);
  }, []);

  const start = useCallback(async () => {
    if (!workspaceId) {
      setError(`Choose a workspace before connecting ${label}.`);
      return;
    }
    setConnection(null);
    setState("starting");
    setError(null);
    try {
      const next = await adminApi.startDeviceLogin(workspaceId, provider);
      if (!mounted.current) return;
      setConnection(next);
      setState("waiting");
    } catch (caught) {
      if (!mounted.current) return;
      setState("idle");
      setError(message(caught));
    }
  }, [workspaceId, provider, label]);

  useEffect(() => {
    if (!connection || state !== "waiting" || !workspaceId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (seconds: number) => {
      timer = setTimeout(() => void poll(), Math.max(1, seconds) * 1000);
    };
    const poll = async () => {
      if (!active) return;
      if (Date.parse(connection.expiresAt) <= Date.now()) {
        setConnection(null);
        setState("idle");
        setError(`This one-time code expired. Start a new ${label} connection.`);
        return;
      }
      try {
        const result = await adminApi.pollDeviceLogin(workspaceId, provider, connection.transactionId);
        if (!active) return;
        // A poll that got through clears an earlier failed poll's error.
        setError(null);
        if (result.status === "pending") {
          schedule(result.retryAfterSeconds ?? connection.intervalSeconds);
          return;
        }
        setConnection(null);
        if (result.status === "connected") {
          setState("connected");
          onConnectedRef.current?.();
          return;
        }
        setState("idle");
        setError(
          result.status === "expired"
            ? `This one-time code expired. Start a new ${label} connection.`
            : `${label} authorization could not be completed. Start a new connection.`,
        );
      } catch (caught) {
        if (!active) return;
        // Keep polling: a transient failure must not abandon a code the
        // operator may already have approved.
        setError(message(caught));
        schedule(connection.intervalSeconds);
      }
    };
    schedule(connection.intervalSeconds);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [connection, state, workspaceId, provider, label]);

  return { connection, state, error, start, reset };
}
