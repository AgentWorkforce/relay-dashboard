#!/bin/sh
# Writes /runtime-config.js (window.__AGENT_RELAY_DASHBOARD_CONFIG__) from the
# DASHBOARD_* env. Run by the nginx image entrypoint before nginx starts.
set -eu

html_root="${DASHBOARD_HTML_ROOT:-/usr/share/nginx/html}"
target="${html_root}/runtime-config.js"

# Values are validated in this shell (not inside a command substitution, where
# an exit would not stop the script).
require_line() {
  case "$1" in
    *[[:cntrl:]]*)
      echo "40-runtime-config: $2 must be a single line without control characters" >&2
      exit 1
      ;;
  esac
}

# JSON string literal for an already-validated single-line value.
json_string() {
  escaped=$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's#</#<\\/#g')
  printf '"%s"' "$escaped"
}

require_path() {
  case "$1" in
    /*) ;;
    *) echo "40-runtime-config: $2 must start with / (got: $1)" >&2; exit 1 ;;
  esac
}

app_path="${DASHBOARD_APP_PATH:-/}"
api_base_path="${DASHBOARD_API_BASE_PATH:-/cloud/api}"
login_path="${DASHBOARD_LOGIN_PATH:-/login}"
public_url="${DASHBOARD_PUBLIC_URL:-}"
# Optional enterprise branding: one JSON object (see README "Customer profile").
# The SPA validates each field and ignores what it can't use.
customer_profile="${DASHBOARD_CUSTOMER_PROFILE:-}"
for pair in "DASHBOARD_APP_PATH=$app_path" "DASHBOARD_API_BASE_PATH=$api_base_path" \
  "DASHBOARD_LOGIN_PATH=$login_path" "DASHBOARD_PUBLIC_URL=$public_url"; do
  require_line "${pair#*=}" "${pair%%=*}"
done
require_path "$app_path" DASHBOARD_APP_PATH
require_path "$api_base_path" DASHBOARD_API_BASE_PATH
require_path "$login_path" DASHBOARD_LOGIN_PATH
# The SPA's API clients call /cloud/api on their own origin (the chart routes
# relaycontrol there); a different prefix would be written but never used.
if [ "$api_base_path" != "/cloud/api" ]; then
  echo "40-runtime-config: DASHBOARD_API_BASE_PATH must be /cloud/api (got: $api_base_path)" >&2
  exit 1
fi
require_line "$customer_profile" DASHBOARD_CUSTOMER_PROFILE
# Surrounding JSON whitespace is fine; the shape check looks past it.
profile_shape=$(printf '%s' "$customer_profile" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
case "$profile_shape" in
  "" | "{"*"}") ;;
  *) echo "40-runtime-config: DASHBOARD_CUSTOMER_PROFILE must be empty or a JSON object" >&2; exit 1 ;;
esac
if [ "${#customer_profile}" -gt 65536 ]; then
  echo "40-runtime-config: DASHBOARD_CUSTOMER_PROFILE is larger than 64 KiB" >&2
  exit 1
fi
case "$public_url" in
  "" | http://* | https://*) ;;
  *) echo "40-runtime-config: DASHBOARD_PUBLIC_URL must be empty or an http(s) URL (got: $public_url)" >&2; exit 1 ;;
esac

tmp="${target}.tmp.$$"
{
  printf 'window.__AGENT_RELAY_DASHBOARD_CONFIG__ = Object.freeze({\n'
  printf '  appPath: %s,\n' "$(json_string "$app_path" DASHBOARD_APP_PATH)"
  printf '  apiBasePath: %s,\n' "$(json_string "$api_base_path" DASHBOARD_API_BASE_PATH)"
  printf '  loginPath: %s,\n' "$(json_string "$login_path" DASHBOARD_LOGIN_PATH)"
  printf '  publicUrl: %s,\n' "$(json_string "$public_url" DASHBOARD_PUBLIC_URL)"
  # Embedded as a JSON string and parsed in the browser, so the profile is
  # data, never script; malformed JSON leaves the default branding.
  if [ -n "$customer_profile" ]; then
    printf '  customerProfile: (function (s) { try { return JSON.parse(s); } catch (e) { return null; } })(%s)\n' \
      "$(json_string "$customer_profile" DASHBOARD_CUSTOMER_PROFILE)"
  else
    printf '  customerProfile: null\n'
  fi
  printf '});\n'
} > "$tmp"
mv "$tmp" "$target"
echo "40-runtime-config: wrote $target" >&2
