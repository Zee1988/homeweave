#!/usr/bin/env bash
# HomeWeave container FAIL-FAST assertions (03-05 Task 1, threat T-03-09).
#
# Usage: scripts/ci/assert-failfast.sh <image-reference>
#
# CI-ONLY, like assert-image.sh: the developer host has no Docker at all
# (02-RESEARCH.md §2). Nothing here has been exercised on a workstation -- do not
# claim a local green run.
#
# What it proves: a container given an environment it cannot work with REFUSES TO
# SERVE and says so with exit code 78 (`EX_CONFIG`), instead of exiting 1 like any
# other crash. That distinction is the whole point of the exit-code split: 1 sends
# an operator looking for a defect, 78 sends them to the configuration. Both cases
# here are pure configuration, and both must land on 78:
#
#   1. DATABASE_URL points at a directory that does not exist -> reason dir_missing
#   2. PORT is not an integer                                   -> reason invalid_port
#
# The log record is asserted too (`startup_failed` plus a `reason`), because a
# bare exit code tells the operator nothing about WHICH input was wrong.

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

EXPECTED_EXIT=78
CASE_TIMEOUT=90
failures=0

pass() {
  printf '✓ %s\n' "$1"
}

fail() {
  printf '✗ %s\n' "$1"
  failures=$((failures + 1))
}

# Cleanup is a trap, not a trailing line: with `set -e` an unexpected failure would
# exit before reaching it. `--rm` already removes the container on a normal exit;
# this catches the case where `timeout` kills the docker CLI and the container
# itself keeps running.
cid=""
cleanup() {
  if [ -n "${cid:-}" ]; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
    cid=""
  fi
}
trap cleanup EXIT

# run_case <label> <expected reason> <env assignment>...
run_case() {
  local label="$1"
  local reason="$2"
  shift 2

  local name="homeweave-failfast-$$-$RANDOM"
  local out=""
  local code=0
  local env_args=()
  local kv
  for kv in "$@"; do
    env_args+=(-e "$kv")
  done

  # `timeout` because a container that is expected to exit must not be able to hang
  # the job: a failing build that wedges the runner is worse than a red one.
  # `cid` is set before the run so a timeout (which kills the CLI, not the container)
  # still leaves the trap something to remove.
  cid="$name"
  out=$(timeout "$CASE_TIMEOUT" docker run --rm --name "$name" "${env_args[@]}" "$IMAGE" 2>&1) || code=$?

  if [ "$code" -ne "$EXPECTED_EXIT" ]; then
    fail "$label: exit code $code, expected $EXPECTED_EXIT"
    printf '    output: %s\n' "$(printf '%s' "$out" | tail -n 5 | tr '\n' ' ' | cut -c1-400)" >&2
    return
  fi

  if ! printf '%s' "$out" | grep -q 'startup_failed'; then
    fail "$label: exited 78 but logged no startup_failed record"
    printf '    output: %s\n' "$(printf '%s' "$out" | tail -n 5 | tr '\n' ' ' | cut -c1-400)" >&2
    return
  fi

  if ! printf '%s' "$out" | grep -q '"reason"'; then
    fail "$label: startup_failed record carries no reason field"
    return
  fi

  # The specific reason is asserted, not just its presence: `dir_missing` and
  # `invalid_port` are the two inputs the case fed in, and a run that reported the
  # wrong one would still exit 78 while pointing the operator at the wrong file.
  if ! printf '%s' "$out" | grep -q "\"$reason\""; then
    fail "$label: reason is not '$reason'"
    printf '    output: %s\n' "$(printf '%s' "$out" | tail -n 5 | tr '\n' ' ' | cut -c1-400)" >&2
    return
  fi

  pass "$label: exit $EXPECTED_EXIT with reason=$reason and a startup_failed record"
}

echo "image: $IMAGE"
echo

# 1. A directory that does not exist. This is also the assertion that the image's
#    own DATABASE_URL default can be overridden -- the value below must win over
#    `ENV DATABASE_URL=file:/data/homeweave.db`, or this case would start normally.
run_case "unwritable database directory" "dir_missing" "DATABASE_URL=file:/nonexistent-dir/x.db"

# 2. A non-numeric PORT. It must be rejected before the port is bound, so a bad
#    option fails the container instead of silently listening on 8099.
run_case "malformed PORT" "invalid_port" "PORT=abc"

echo
if [ "$failures" -ne 0 ]; then
  printf '✗ assert-failfast failed: %s case(s) failed\n' "$failures" >&2
  exit 1
fi
printf '✓ all fail-fast assertions passed\n'
