import { useEffect } from "react";

export const loginHref = "/login?next=%2Fdashboard%2F";

/** The marketing application owns the login page and provider flows. */
export function Login() {
  useEffect(() => {
    window.location.replace(loginHref);
  }, []);
  return (
    <main className="auth-status">
      <p>Taking you to sign in…</p>
      <a href={loginHref}>Continue to Agent Relay</a>
    </main>
  );
}
