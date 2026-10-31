import {
  productionOrigin,
  saveCredentials,
  credentialPath,
} from "../dev/production-api.mjs";
import { setTimeout as delay } from "node:timers/promises";
const base = `${productionOrigin}/cloud/api/v1/auth`;
async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  return { ok: response.ok, body: await response.json() };
}
try {
  const started = await post("/device/start", {
    client_name: "Dashboard local development",
  });
  if (!started.ok) throw new Error("Could not start production sign-in.");
  const grant = started.body;
  const approval = new URL(grant.verification_uri_complete);
  if (
    approval.origin !== productionOrigin ||
    approval.pathname !== "/cloud/device"
  )
    throw new Error("Unexpected approval URL.");
  console.log(
    `Sign in to production and approve local UI development:\n${approval}\nCode: ${grant.user_code}\nWaiting for approval…`,
  );
  const deadline = Date.now() + grant.expires_in * 1000;
  let interval = Math.max(5, grant.interval || 5);
  let complete = false;
  while (Date.now() < deadline) {
    await delay(interval * 1000);
    const result = await post("/device/token", {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: grant.device_code,
    });
    if (result.ok) {
      const token = result.body;
      if (!token.access_token || !token.refresh_token)
        throw new Error("Invalid token response.");
      await saveCredentials({
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        accessTokenExpiresAt: token.access_token_expires_at,
        refreshTokenExpiresAt: token.refresh_token_expires_at,
      });
      console.log(
        `Production sign-in saved privately to ${credentialPath}.\nRun npm run dev:prod and open http://127.0.0.1:5173/dashboard/`,
      );
      complete = true;
      break;
    }
    if (result.body.error === "authorization_pending") continue;
    if (result.body.error === "slow_down") {
      interval += 5;
      continue;
    }
    throw new Error(
      "Sign-in declined or expired. Run npm run login:prod again.",
    );
  }
  if (!complete)
    throw new Error("Sign-in expired. Run npm run login:prod again.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
