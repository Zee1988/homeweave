#!/usr/bin/env bash
# HomeWeave container GRACEFUL SHUTDOWN assertions (03-05 Task 2).
#
# Usage: scripts/ci/assert-shutdown.sh <image-reference>
#
# CI-ONLY: the developer host has no Docker at all (02-RESEARCH.md §2). The shutdown
# path itself is covered portably by apps/api/test/shutdown.dist.test.mjs; this script
# is what proves it under a real SIGTERM, in the real image, through `docker stop` --
# the exact sequence the Supervisor performs on an App update or stop.
#
# Reference for the expected lines (apps/api/src/lifecycle/shutdown.service.ts):
#
#   shutdown: stop accepting new requests   <- readiness flips, drain begins
#   shutdown: prisma disconnected           <- connection closed after the server
#   8 s budget elapsed -> shutdown_forced   <- backstop, must NOT appear here
#
# The four assertions, and why each one is not redundant:
#
#   1. exit code 0        A drain that ends in SIGKILL cannot be told apart from a
#                         crash, and the Supervisor's restart/backoff treats them the
#                         same. 137 (or 143) here means the process was killed.
#   2. log order          "prisma disconnected" before "stop accepting" would mean the
#                         database was torn out while requests were still in flight.
#   3. no shutdown_forced The 8 s budget is a backstop, not a routine path. If it fires
#                         in a plain `docker stop`, something keeps the drain open.
#   4. duration < 10 s    `docker stop` defaults to a 10 s grace period before SIGKILL;
#                         finishing inside it is what makes the exit graceful at all.

set -euo pipefail

IMAGE="${1:-}"
if [ -z "$IMAGE" ]; then
  echo "usage: $0 <image-reference>" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker is not available on this machine; these assertions are CI-only (see docs/23)" >&2
  exit 1
fi

STOP_TIMEOUT_SECONDS=15
LIVE_DEADLINE_SECONDS=90
BUDGET_MS=10000
failures=0

pass() {
  printf '✓ %s\n' "$1"
}

fail() {
  printf '✗ %s\n' "$1"
  failures=$((failures + 1))
}

# A leaked container on a shared runner is a resource the next run fights over, so
# cleanup is a trap rather than the last line of the script.
cid=""
cleanup() {
  if [ -n "${cid:-}" ]; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
    cid=""
  fi
}
trap cleanup EXIT

echo "image: $IMAGE"

name="homeweave-shutdown-$$-$RANDOM"
cid=$(docker run -d --name "$name" "$IMAGE")

# ---------------------------------------------------------------------------
# Wait until the API is actually serving. Probing from inside with `node -e fetch`
# keeps the image free of curl/wget and matches what the Supervisor watchdog hits.
# ---------------------------------------------------------------------------
live=0
attempts=0
while [ "$attempts" -lt "$LIVE_DEADLINE_SECONDS" ]; do
  attempts=$((attempts + 1))
  if docker exec "$cid" node -e '
    fetch("http://127.0.0.1:8099/health/live")
      .then((response) => process.exit(response.status === 200 ? 0 : 1))
      .catch(() => process.exit(1));
  ' >/dev/null 2>&1; then
    live=1
    break
  fi
  sleep 1
done

if [ "$live" -ne 1 ]; then
  fail "the API never answered /health/live inside the container (after ${attempts}s)"
  docker logs "$cid" 2>&1 | tail -n 40 || true
  echo
  printf '✗ assert-shutdown failed: %s check(s) failed\n' "$failures" >&2
  exit 1
fi
pass "/health/live answered 200 before the stop (${attempts}s)"

# ---------------------------------------------------------------------------
# Stop it the way the Supervisor does, and time it.
# ---------------------------------------------------------------------------
start_ns=$(date +%s%N)
if ! docker stop --time "$STOP_TIMEOUT_SECONDS" "$cid" >/dev/null 2>&1; then
  fail "docker stop returned an error"
fi
end_ns=$(date +%s%N)
elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))

exit_code=$(docker inspect -f '{{.State.ExitCode}}' "$cid" 2>/dev/null || echo "unknown")
logs=$(docker logs "$cid" 2>&1 || true)

if [ "$exit_code" = "0" ]; then
  pass "exit code is 0 (a voluntary stop, not a crash and not SIGKILL)"
else
  fail "exit code is '$exit_code', expected 0 (137/143 means the process was killed)"
  printf '%s\n' "$logs" | tail -n 30 >&2
fi

# ---------------------------------------------------------------------------
# Log order. Line numbers rather than "does A appear before B in the text": the
# records are JSON and a naive substring comparison would pass on any run where the
# two strings happen to be ordered by luck inside one line.
# ---------------------------------------------------------------------------
stop_line=$(printf '%s\n' "$logs" | grep -n 'stop accepting new requests' | head -n 1 | cut -d: -f1 || true)
disconnect_line=$(printf '%s\n' "$logs" | grep -n 'prisma disconnected' | head -n 1 | cut -d: -f1 || true)

if [ -z "$stop_line" ]; then
  fail "the log has no 'shutdown: stop accepting new requests' record"
  printf '%s\n' "$logs" | tail -n 30 >&2
elif [ -z "$disconnect_line" ]; then
  fail "the log has no 'shutdown: prisma disconnected' record (the drain never completed)"
  printf '%s\n' "$logs" | tail -n 30 >&2
elif [ "$stop_line" -lt "$disconnect_line" ]; then
  pass "log order is stop accepting new requests (line $stop_line) -> prisma disconnected (line $disconnect_line)"
else
  fail "the database disconnected (line $disconnect_line) before the drain began (line $stop_line)"
fi

if printf '%s\n' "$logs" | grep -q 'shutdown_forced'; then
  fail "the 8 s budget fired during a plain 'docker stop': something kept the drain open"
  printf '%s\n' "$logs" | tail -n 30 >&2
else
  pass "the 8 s budget did not fire"
fi

if printf '%s\n' "$logs" | grep -Eq 'SIGKILL|Killed'; then
  fail "the log mentions SIGKILL/Killed, so the drain was cut short"
else
  pass "no SIGKILL in the log"
fi

if [ "$elapsed_ms" -lt "$BUDGET_MS" ]; then
  pass "docker stop completed in ${elapsed_ms}ms (< ${BUDGET_MS}ms, inside the 10 s default grace period)"
else
  fail "docker stop took ${elapsed_ms}ms, at or over the ${BUDGET_MS}ms budget"
fi

echo
if [ "$failures" -ne 0 ]; then
  printf '✗ assert-shutdown failed: %s check(s) failed\n' "$failures" >&2
  exit 1
fi
printf '✓ all shutdown assertions passed\n'
