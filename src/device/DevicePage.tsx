import { useEffect, useRef, useState } from "react";
import { getAccount, SignedOut } from "../api/client";
import type { Account } from "../api/contracts";
import { appPath, loginHref } from "../app-path";
import {
  approvalName,
  deviceApi,
  DeviceError,
  DeviceSignedOut,
  FINAL_ERRORS,
  displayClientName,
  normalizeUserCode,
  workspaceLabel,
  type DeviceLookup,
} from "./api";
import { Check, X } from "lucide-react";
import { BrandLockup } from "../shell/brand";
import { branding } from "../shell/branding";

// Hosted app/device/_components/device-approval.tsx action buttons.
const primaryAction =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--brand-button-border,#234969)] bg-[var(--brand-button,#2d6a9c)] px-4 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-button-hover,#4a90c2)] active:bg-[var(--brand-button-border,#234969)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#80bfe5] disabled:cursor-not-allowed disabled:opacity-50";
const secondaryAction =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-[#496174] bg-transparent px-4 text-sm font-medium text-[#e8f0f7] transition-colors hover:bg-[#24394b] active:bg-[#1c3041] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#80bfe5] disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Authorize a device (hosted Cloud's `/device`). Two steps: look the code up
 * and show which app or machine is asking and which workspace it will reach,
 * then an explicit Approve or Deny. The confirmation step is the
 * anti-phishing control: a person sent here with someone else's code sees a
 * machine they do not recognize before anything is granted.
 */
export function DevicePage(props: {
  initialUserCode: string;
  /** Leaves for sign-in; replaceable in tests. */
  navigate?: (url: string) => void;
}) {
  const brand = branding();
  const navigate = props.navigate ?? ((url: string) => window.location.replace(url));
  const [account, setAccount] = useState<Account | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [userCode, setUserCode] = useState(props.initialUserCode);
  const [lookup, setLookup] = useState<DeviceLookup | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "denied" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoLookup = useRef(props.initialUserCode.trim().length > 0);

  useEffect(() => {
    const attempt = new AbortController();
    getAccount(attempt.signal)
      .then((value) => {
        if (!attempt.signal.aborted) setAccount(value);
      })
      .catch((reason: unknown) => {
        if (attempt.signal.aborted) return;
        if (reason instanceof SignedOut) setSignedOut(true);
        else setError("Couldn’t check your sign-in. Reload to try again.");
      });
    return () => attempt.abort();
  }, []);

  // Sign in first, then come back to this page with the same code, including
  // one typed into the form rather than carried by the link.
  useEffect(() => {
    if (!signedOut) return;
    const code = normalizeUserCode(userCode);
    navigate(
      code
        ? loginHref(
            `${window.location.pathname}${window.location.search}#/device?user_code=${encodeURIComponent(code)}`,
          )
        : loginHref(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOut]);

  async function check(code: string) {
    const normalized = normalizeUserCode(code);
    if (!normalized) {
      setError("Enter the 8-character code shown in the app or device you’re connecting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const found = await deviceApi.lookup(normalized);
      if (found.status !== "pending") {
        setError(
          found.status === "expired"
            ? "That code has expired. Start a new sign-in on the device."
            : "That code has already been used.",
        );
        return;
      }
      setUserCode(found.user_code);
      setLookup(found);
    } catch (reason) {
      if (reason instanceof DeviceSignedOut) setSignedOut(true);
      else setError(reason instanceof Error ? reason.message : "Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!account || !autoLookup.current) return;
    autoLookup.current = false;
    void check(props.initialUserCode);
    // Runs once, for the code the page was opened with, after sign-in is known.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  async function decide(action: "approve" | "deny") {
    if (!lookup) return;
    setBusy(true);
    setError(null);
    try {
      await deviceApi.decide(action, lookup.user_code);
      setOutcome(action === "approve" ? "approved" : "denied");
    } catch (reason) {
      if (reason instanceof DeviceSignedOut) setSignedOut(true);
      else {
        // A used, expired or unknown code can't be decided: drop the
        // Approve/Deny step and show only the refusal.
        if (reason instanceof DeviceError && FINAL_ERRORS.has(reason.code))
          setLookup(null);
        setError(reason instanceof Error ? reason.message : "Network error. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const workspace = lookup ? workspaceLabel(lookup) : null;

  return (
    <div className="min-h-dvh bg-[#101c29] text-[#e8f0f7]">
      <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-12 sm:py-16">
        <a
          href={appPath()}
          aria-label={`${brand.productName} home`}
          className="mb-8 flex w-fit shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#79b8de]"
        >
          <BrandLockup
            brand={brand}
            markClassName="h-6"
            wordmarkClassName="h-5 [--fg:#e8f0f7]"
            logoClassName="h-6 w-auto max-w-[200px] object-contain object-left"
            variant="dark"
          />
        </a>
        <div className="mb-9">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Authorize a device
          </h1>
          <p className="mt-3 max-w-xl text-base leading-7 text-[#a9bdce]">
            Connect an app or device to your {brand.productName} workspace. Only approve
            a sign-in you started yourself.
          </p>
          {account && (
            <p className="mt-3 text-sm text-[#a9bdce]">
              Signed in as{" "}
              <span className="font-medium text-[#e8f0f7]">
                {account.user.name || "your account"}
              </span>
              {account.currentWorkspace
                ? ` · ${account.currentWorkspace.name}`
                : ""}
            </p>
          )}
        </div>
        <section
          className="rounded-xl border border-[#30485e] bg-[#182838] p-6 sm:p-8"
          aria-label="Device authorization"
        >
          {signedOut && (
            <p role="status" className="text-sm leading-7 text-[#e8f0f7]">
              Taking you to sign in…
            </p>
          )}
          {!signedOut && !account && !error && (
            <p role="status" className="text-sm leading-7 text-[#a9bdce]">
              Checking your sign-in…
            </p>
          )}

          {account && outcome && (
            <div role="status" className="flex items-start gap-4">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#203e55] text-[#80bfe5]"
                aria-hidden="true"
              >
                {outcome === "approved" ? (
                  <Check size={19} strokeWidth={2.5} />
                ) : (
                  <X size={19} strokeWidth={2.5} />
                )}
              </span>
              <div className="min-w-0 break-words">
                <h2 className="text-lg font-semibold text-[#e8f0f7]">
                  {outcome === "approved" ? "Device approved" : "Device denied"}
                </h2>
                <p className="mt-1 text-sm leading-6 text-[#a9bdce]">
                  {outcome === "approved"
                    ? `Return to ${lookup ? approvalName(lookup) : "the app or device where you started signing in"}. Sign-in will finish within a few seconds. You can close this tab.`
                    : "No credentials were issued. You can close this tab."}
                </p>
              </div>
            </div>
          )}

          {account && !outcome && lookup && (
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-[#a9bdce]">
                  Requesting app or device
                </p>
                <h2 className="mt-3 break-words text-lg font-medium text-[#e8f0f7]">
                  {approvalName(lookup)}
                </h2>
                <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-[#a9bdce]">Code</dt>
                  <dd className="min-w-0 break-words">
                    <code className="font-mono tracking-[0.12em]">
                      {lookup.user_code}
                    </code>
                  </dd>
                  {lookup.desktop_host_name && (
                    <>
                      <dt className="text-[#a9bdce]">Client</dt>
                      <dd className="min-w-0 break-words">
                        {displayClientName(lookup.client_name)}
                      </dd>
                    </>
                  )}
                  <dt className="text-[#a9bdce]">Workspace</dt>
                  <dd className="min-w-0 break-words">
                    {workspace ?? "Your current workspace"}
                  </dd>
                  <dt className="text-[#a9bdce]">Expires</dt>
                  <dd>
                    <time dateTime={lookup.expires_at}>
                      {new Date(lookup.expires_at).toLocaleTimeString()}
                    </time>
                  </dd>
                </dl>
                <p className="mt-2 text-sm leading-7 text-[#a9bdce]">
                  {lookup.desktop_host_name
                    ? `Approving authorizes Agent Relay Desktop on ${lookup.desktop_host_name} to access ${workspace ?? "your workspace"}. Check that this is the computer where you started sign-in; otherwise, deny it.`
                    : `Approving grants this app or device access to ${workspace ?? "your workspace"}. If you did not start this sign-in, deny it.`}
                </p>
              </div>
              {error && (
                <p role="alert" className="text-sm text-[#f3a5ad]">
                  {error}
                </p>
              )}
              <div className="flex flex-col gap-3 sm:flex-row">
                <button
                  type="button"
                  data-slot="device-action"
                  className={primaryAction}
                  disabled={busy}
                  onClick={() => void decide("approve")}
                >
                  {busy ? "Working…" : "Approve"}
                </button>
                <button
                  type="button"
                  data-slot="device-action"
                  className={secondaryAction}
                  disabled={busy}
                  onClick={() => void decide("deny")}
                >
                  Deny
                </button>
              </div>
            </div>
          )}

          {account && !outcome && !lookup && (
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void check(userCode);
              }}
            >
              <div>
                <label
                  htmlFor="user_code"
                  className="text-sm font-medium text-[#a9bdce]"
                >
                  Device code
                </label>
                <p
                  id="device-code-help"
                  className="mt-2 text-sm leading-6 text-[#a9bdce]"
                >
                  Enter the code shown in the app or device you’re connecting.
                </p>
                <input
                  id="user_code"
                  name="user_code"
                  data-slot="input"
                  aria-describedby="device-code-help"
                  value={userCode}
                  onChange={(event) => setUserCode(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="XXXX-XXXX"
                  className="mt-3 w-full rounded-md border border-[#30485e] bg-[#101c29] px-4 py-3 font-mono text-lg tracking-[0.3em] text-[#e8f0f7] outline-none transition-colors placeholder:text-[#8298aa] focus:border-[#80bfe5] focus-visible:ring-2 focus-visible:ring-[#80bfe5]/30"
                />
              </div>
              {error && (
                <p role="alert" className="text-sm text-[#f3a5ad]">
                  {error}
                </p>
              )}
              <button
                type="submit"
                data-slot="device-action"
                className={primaryAction}
                disabled={busy || userCode.trim().length === 0}
              >
                {busy ? "Checking…" : "Continue"}
              </button>
            </form>
          )}

          {!account && error && (
            <p role="alert" className="text-sm text-[#f3a5ad]">
              {error}
            </p>
          )}
        </section>
        {(brand.supportUrl || brand.poweredBy) && (
          <p className="mt-6 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#a9bdce]">
            {brand.supportUrl && (
              <a
                href={brand.supportUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-4 hover:text-[#e8f0f7]"
              >
                Contact support
              </a>
            )}
            {brand.poweredBy && <span data-powered-by>Powered by Agent Relay</span>}
          </p>
        )}
      </main>
    </div>
  );
}
