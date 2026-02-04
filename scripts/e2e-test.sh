#!/bin/bash
#
# E2E Test for Dashboard Server
# Tests that the dashboard starts and serves pages correctly
#
# Usage:
#   ./scripts/e2e-test.sh              # Run with default port
#   ./scripts/e2e-test.sh --port 3890  # Use custom port
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration
DASHBOARD_PORT="${DASHBOARD_PORT:-3890}"
STARTUP_TIMEOUT=30
TEST_DATA_DIR="/tmp/dashboard-e2e-test-$$"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --port)
      DASHBOARD_PORT="$2"
      shift 2
      ;;
    --port=*)
      DASHBOARD_PORT="${1#*=}"
      shift
      ;;
    *)
      shift
      ;;
  esac
done

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_phase() { echo -e "\n${CYAN}========================================${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}========================================${NC}\n"; }

# Cleanup function
cleanup() {
  echo ""
  log_phase "Cleanup"

  if [ -n "$DASHBOARD_PID" ] && kill -0 "$DASHBOARD_PID" 2>/dev/null; then
    log_info "Stopping dashboard server (PID: $DASHBOARD_PID)..."
    kill "$DASHBOARD_PID" 2>/dev/null || true
    wait "$DASHBOARD_PID" 2>/dev/null || true
  fi

  # Clean up test data directory
  if [ -d "$TEST_DATA_DIR" ]; then
    rm -rf "$TEST_DATA_DIR"
  fi

  # Force kill any remaining process on the port
  if command -v lsof &> /dev/null; then
    lsof -ti:$DASHBOARD_PORT | xargs kill -9 2>/dev/null || true
  fi

  log_info "Cleanup complete."
}
trap cleanup EXIT

# Ensure we're in the project directory
cd "$PROJECT_DIR"

echo ""
log_phase "E2E Test: Dashboard Server"

log_info "Configuration:"
log_info "  Port: $DASHBOARD_PORT"
log_info "  Test data dir: $TEST_DATA_DIR"

# Phase 0: Build check
log_phase "Phase 0: Build Check"

if [ ! -f "$PROJECT_DIR/packages/dashboard-server/dist/start.js" ]; then
  log_info "Building project..."
  npm run build
else
  log_info "Build exists, skipping (run 'npm run build' to rebuild)"
fi

# Phase 1: Setup test environment
log_phase "Phase 1: Setup Test Environment"

mkdir -p "$TEST_DATA_DIR"
mkdir -p "$TEST_DATA_DIR/team"

# Create a minimal relay.sock placeholder (the server will handle missing daemon gracefully)
log_info "Test data directory created: $TEST_DATA_DIR"

# Phase 2: Start dashboard server
log_phase "Phase 2: Starting Dashboard Server"

# Kill any existing process on the port
if command -v lsof &> /dev/null; then
  lsof -ti:$DASHBOARD_PORT | xargs kill -9 2>/dev/null || true
fi
sleep 1

# Start dashboard server
DASHBOARD_LOG="$TEST_DATA_DIR/dashboard.log"
node "$PROJECT_DIR/packages/dashboard-server/dist/start.js" \
  --port "$DASHBOARD_PORT" \
  --data-dir "$TEST_DATA_DIR" \
  --team-dir "$TEST_DATA_DIR/team" \
  --mock \
  > "$DASHBOARD_LOG" 2>&1 &
DASHBOARD_PID=$!

log_info "Dashboard server started (PID: $DASHBOARD_PID)"
log_info "Log file: $DASHBOARD_LOG"

# Wait for server to be ready
log_info "Waiting for server to be ready..."
for i in $(seq 1 $STARTUP_TIMEOUT); do
  if curl -s "http://127.0.0.1:${DASHBOARD_PORT}/health" > /dev/null 2>&1; then
    log_info "Server is ready!"
    break
  fi

  # Check if process died
  if ! kill -0 "$DASHBOARD_PID" 2>/dev/null; then
    log_error "Dashboard server died during startup"
    log_error "Log output:"
    cat "$DASHBOARD_LOG" 2>/dev/null || echo "(no log)"
    exit 1
  fi

  if [ $i -eq $STARTUP_TIMEOUT ]; then
    log_error "Server failed to start within ${STARTUP_TIMEOUT}s"
    log_error "Log tail:"
    tail -50 "$DASHBOARD_LOG" 2>/dev/null || echo "(no log)"
    exit 1
  fi

  if [ $((i % 5)) -eq 0 ]; then
    echo "  Still waiting... (${i}s)"
  fi
  sleep 1
done

# Phase 3: Test endpoints
log_phase "Phase 3: Testing Endpoints"

TEST_PASSED=true

# Test health endpoint
log_info "Testing: GET /health"
HEALTH_RESPONSE=$(curl -s "http://127.0.0.1:${DASHBOARD_PORT}/health")
if [ -z "$HEALTH_RESPONSE" ]; then
  log_error "  /health returned empty response"
  TEST_PASSED=false
else
  log_info "  /health OK: $HEALTH_RESPONSE"
fi

# Test root page (should return HTML, not 404)
log_info "Testing: GET /"
ROOT_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "http://127.0.0.1:${DASHBOARD_PORT}/")
if [ "$ROOT_STATUS" = "200" ]; then
  log_info "  / OK (status: $ROOT_STATUS)"
else
  log_error "  / FAILED (status: $ROOT_STATUS, expected 200)"
  TEST_PASSED=false
fi

# Test /app page (may redirect to /app/, so follow redirects)
log_info "Testing: GET /app"
APP_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "http://127.0.0.1:${DASHBOARD_PORT}/app")
if [ "$APP_STATUS" = "200" ]; then
  log_info "  /app OK (status: $APP_STATUS)"
else
  log_error "  /app FAILED (status: $APP_STATUS, expected 200)"
  TEST_PASSED=false
fi

# Test /app/agent/TestAgent (catch-all route)
log_info "Testing: GET /app/agent/TestAgent"
APP_AGENT_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "http://127.0.0.1:${DASHBOARD_PORT}/app/agent/TestAgent")
if [ "$APP_AGENT_STATUS" = "200" ]; then
  log_info "  /app/agent/TestAgent OK (status: $APP_AGENT_STATUS)"
else
  log_error "  /app/agent/TestAgent FAILED (status: $APP_AGENT_STATUS, expected 200)"
  TEST_PASSED=false
fi

# Test /metrics page
log_info "Testing: GET /metrics"
METRICS_STATUS=$(curl -sL -o /dev/null -w "%{http_code}" "http://127.0.0.1:${DASHBOARD_PORT}/metrics")
if [ "$METRICS_STATUS" = "200" ]; then
  log_info "  /metrics OK (status: $METRICS_STATUS)"
else
  log_error "  /metrics FAILED (status: $METRICS_STATUS, expected 200)"
  TEST_PASSED=false
fi

# Test WebSocket upgrade endpoint exists (returns 426 Upgrade Required without WS)
log_info "Testing: GET /ws (WebSocket endpoint)"
WS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${DASHBOARD_PORT}/ws")
# WebSocket endpoint should return something (not 404)
if [ "$WS_STATUS" != "404" ]; then
  log_info "  /ws OK (status: $WS_STATUS - endpoint exists)"
else
  log_error "  /ws FAILED (status: $WS_STATUS, endpoint not found)"
  TEST_PASSED=false
fi

# Phase 4: Verify server stops cleanly
log_phase "Phase 4: Stopping Server"

log_info "Sending SIGTERM to dashboard server..."
kill "$DASHBOARD_PID" 2>/dev/null || true

# Wait for graceful shutdown
for i in $(seq 1 10); do
  if ! kill -0 "$DASHBOARD_PID" 2>/dev/null; then
    log_info "Server stopped cleanly"
    break
  fi
  if [ $i -eq 10 ]; then
    log_warn "Server didn't stop gracefully, force killing..."
    kill -9 "$DASHBOARD_PID" 2>/dev/null || true
  fi
  sleep 1
done

# Clear PID so cleanup doesn't try again
DASHBOARD_PID=""

# Final result
echo ""
if [ "$TEST_PASSED" = true ]; then
  log_info "=== E2E TEST PASSED ==="
  exit 0
else
  log_error "=== E2E TEST FAILED ==="
  exit 1
fi
