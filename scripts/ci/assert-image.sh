#!/bin/sh
# HomeWeave image content assertions (IMG-01, IMG-02, SEC-03).
#
# Usage: scripts/ci/assert-image.sh <image-reference>
#
# This script is CI-ONLY. The developer host has no Docker at all (02-RESEARCH.md
# §2), so nothing here can be exercised locally: every result below is "unverified
# on the authoring machine". Do not describe a green local run of this file — there
# was none (D-8).
#
# It is called by the `verify-image` job in .github/workflows/release.yml (plan
# 02-04). That link is the whole reason the file lives under scripts/ci/: an
# assertion nobody invokes is a comment with extra steps.
#
# Eight checks, in order:
#   1. devDependencies absent      (typescript, @nestjs/cli, jest, eslint, ts-node, prisma)
#   2. sources absent              (no /app/src, no *.ts, no *.spec.ts outside node_modules)
#   3. source maps absent          (no *.map outside node_modules)
#   4. build artifacts present     (dist/main.js, Prisma Client, prisma/migrations/*/migration.sql)
#   5. engine architecture         (CONDITIONAL on apps/api/prisma/ENGINE_DECISION)
#   6. the container starts         (startup log line + State.Running == true)
#   7. no secret in image history  (docker history --no-trunc)
#   8. no secret in the filesystem (.env / .env.* / *.pem / *.key outside node_modules)
#
# Exit codes: 0 = all checks passed, 1 = at least one failed or a precondition was
# not met. There is no third outcome and no "skipped" exit path: an unrunnable check
# is a failure, because a green run that verified nothing is worse than a red one.

set -eu

IMAGE="${1:-}"

if [ -z "$IMAGE" ]; then
  echo "usage: $0 <image-reference>" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)

# The engine decision is a property of the *repository*, not of the image, so it is
# read from the checkout the CI job is running in. Overridable for a test harness.
ENGINE_DECISION_FILE="${ENGINE_DECISION_FILE:-$REPO_ROOT/apps/api/prisma/ENGINE_DECISION}"

failures=0

pass() {
  printf '✓ %s\n' "$1"
}

fail() {
  printf '✗ %s\n' "$1"
  failures=$((failures + 1))
}

# Container cleanup MUST be a trap, not a line at the end of the script: under
# `set -e` an unexpected failure exits immediately, so a trailing `docker rm` would
# never run and every failed CI run would leak a container.
#
# `${cid:-}` rather than `$cid`: with `set -u` an early exit (before any container
# exists) would otherwise make the trap itself fail with "unbound variable" and mask
# the real error.
cid=""
cleanup() {
  if [ -n "${cid:-}" ]; then
    docker rm -f "$cid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "✗ docker is not available on this machine; image assertions are CI-only (see docs/21)" >&2
  exit 1
fi

echo "image: $IMAGE"
echo "engine decision file: $ENGINE_DECISION_FILE"

# ---------------------------------------------------------------------------
# 1. devDependencies must not be in the image (IMG-02).
# ---------------------------------------------------------------------------
leaked=$(docker run --rm "$IMAGE" sh -c '
  for dep in typescript @nestjs/cli jest eslint ts-node prisma; do
    if [ -e "node_modules/$dep" ]; then echo "LEAK:$dep"; fi
  done
')
if [ -z "$leaked" ]; then
  pass "1/8 devDependencies absent (typescript, @nestjs/cli, jest, eslint, ts-node, prisma)"
else
  fail "1/8 devDependencies present in the image: $(echo "$leaked" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 2. No TypeScript sources, no spec files (IMG-02 / threat T-02-04).
# ---------------------------------------------------------------------------
sources=$(docker run --rm "$IMAGE" sh -c '
  find /app -path /app/node_modules -prune -o -type f \( -name "*.ts" -o -name "*.spec.ts" \) -print
  if [ -d /app/src ]; then echo "LEAK:/app/src"; fi
')
if [ -z "$sources" ]; then
  pass "2/8 sources absent (no /app/src, no *.ts, no *.spec.ts outside node_modules)"
else
  fail "2/8 source files present in the image: $(echo "$sources" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 3. No source maps (IMG-02). tsconfig already sets sourceMap:false; this is the
#    second line of defence, because a map embeds sourcesContent and re-leaks the
#    sources in another form.
# ---------------------------------------------------------------------------
maps=$(docker run --rm "$IMAGE" sh -c '
  find /app -path /app/node_modules -prune -o -type f -name "*.map" -print
')
if [ -z "$maps" ]; then
  pass "3/8 no *.map outside node_modules"
else
  fail "3/8 source maps present in the image: $(echo "$maps" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 4. The things that MUST be there (IMG-01).
#
#    The Prisma Client location is dist/generated/prisma, not
#    node_modules/.prisma/client: this repo uses Prisma 7's `prisma-client`
#    generator with an explicit output, so the client is TypeScript compiled by tsc
#    into dist/ (02-02 / 02-03).
# ---------------------------------------------------------------------------
artifacts=$(docker run --rm "$IMAGE" sh -c '
  missing=0
  if [ -f /app/dist/main.js ]; then echo "OK:dist/main.js"; else echo "MISSING:dist/main.js"; missing=1; fi
  if [ -f /app/dist/generated/prisma/client.js ]; then echo "OK:dist/generated/prisma"; else echo "MISSING:dist/generated/prisma"; missing=1; fi
  if ls /app/prisma/migrations/*/migration.sql >/dev/null 2>&1; then echo "OK:prisma/migrations"; else echo "MISSING:prisma/migrations"; missing=1; fi
  exit "$missing"
' || true)
if [ -n "$artifacts" ] && ! echo "$artifacts" | grep -q '^MISSING:'; then
  pass "4/8 artifacts present ($(echo "$artifacts" | tr '\n' ' '))"
else
  fail "4/8 artifacts missing from the image: $(echo "$artifacts" | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 5. Engine architecture — CONDITIONAL.
#
#    The switch is apps/api/prisma/ENGINE_DECISION, a file, not a prose convention:
#    an earlier revision of this plan relied on "remember to delete the check" and
#    nothing enforced it. Two legal values:
#
#      NATIVE_ENGINE -> the generated client carries a native query engine, so the
#                       engine file name must match the container's real
#                       `node -p process.arch`. A mismatch is a green build that
#                       crashes on first query (docs/21:134).
#      RUST_FREE     -> Prisma 7 WASM query compiler, no native binary to match.
#                       This branch is the current repository state; it prints
#                       `- skipped (RUST_FREE)` and is NOT a silent pass.
#
#    Anything else — file missing, empty, or an unknown value — is exit 1. "I could
#    not tell" must never be reported as "fine".
# ---------------------------------------------------------------------------
decision=""
if [ -f "$ENGINE_DECISION_FILE" ]; then
  decision=$(tr -d ' \t\r\n' < "$ENGINE_DECISION_FILE")
fi

case "$decision" in
  NATIVE_ENGINE)
    container_arch=$(docker run --rm "$IMAGE" node -p 'process.arch' | tr -d ' \r\n')
    case "$container_arch" in
      x64) engine_target="debian-openssl-3.0.x" ;;
      arm64) engine_target="linux-arm64-openssl-3.0.x" ;;
      *) engine_target="" ;;
    esac
    if [ -z "$engine_target" ]; then
      fail "5/8 NATIVE_ENGINE but the container reported an arch with no known engine target: '$container_arch'"
    else
      engine_file=$(docker run --rm "$IMAGE" sh -c "find /app -name '*${engine_target}*.so.node' -print | head -n 1")
      if [ -n "$engine_file" ]; then
        pass "5/8 engine matches architecture $container_arch ($engine_target): $engine_file"
      else
        fail "5/8 NATIVE_ENGINE but no engine matching '$engine_target' exists for arch '$container_arch'"
      fi
    fi
    ;;
  RUST_FREE)
    echo "  - skipped (RUST_FREE): Prisma 7 uses the WASM query compiler, there is no native engine file to match against process.arch"
    pass "5/8 engine architecture check resolved by ENGINE_DECISION=RUST_FREE"
    ;;
  *)
    fail "5/8 ENGINE_DECISION unreadable or invalid at $ENGINE_DECISION_FILE (expected NATIVE_ENGINE or RUST_FREE, got '${decision:-<empty>}')"
    ;;
esac

# ---------------------------------------------------------------------------
# 6. The container actually starts (IMG-01).
#
#    Proof is the Nest startup log line plus State.Running, not "docker run returned
#    0": a process that starts and immediately throws also returns 0 from `run -d`.
# ---------------------------------------------------------------------------
cid=$(docker run -d "$IMAGE")
deadline=$(( $(date +%s) + 90 ))
started=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if docker logs "$cid" 2>&1 | grep -q 'Nest application successfully started'; then
    started=1
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)" != "true" ]; then
    break
  fi
  sleep 2
done

running=$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || echo false)
if [ "$started" -eq 1 ] && [ "$running" = "true" ]; then
  pass "6/8 container started and is still running (startup log line seen, State.Running=true)"
else
  fail "6/8 container did not start cleanly (startup log seen=$started, State.Running=$running)"
  docker logs "$cid" 2>&1 | tail -n 40 || true
fi

# ---------------------------------------------------------------------------
# 7. No secret in the image history (SEC-03 / threat T-02-03).
#
#    `--no-trunc` matters: the default output ellipsises long RUN commands, which is
#    exactly where an accidentally inlined token would hide.
# ---------------------------------------------------------------------------
history_hits=$(docker history --no-trunc "$IMAGE" 2>/dev/null | \
  grep -E 'ghp_|github_pat_|password=|secret=|BEGIN [A-Z ]*PRIVATE KEY' || true)
if [ -z "$history_hits" ]; then
  pass "7/8 no secret pattern in docker history --no-trunc"
else
  fail "7/8 secret pattern found in the image history: $(echo "$history_hits" | head -n 3 | cut -c1-200 | tr '\n' ' ')"
fi

# ---------------------------------------------------------------------------
# 8. No secret file in the image filesystem (SEC-03).
#
#    node_modules is pruned because a dependency may legitimately ship test
#    fixtures named *.key; the image's own tree is what must be clean.
# ---------------------------------------------------------------------------
fs_hits=$(docker run --rm "$IMAGE" sh -c '
  find / -path "*/node_modules/*" -prune -o -type f \( -name ".env" -o -name ".env.*" -o -name "*.pem" -o -name "*.key" \) -print 2>/dev/null
' || true)
if [ -z "$fs_hits" ]; then
  pass "8/8 no .env / .env.* / *.pem / *.key outside node_modules"
else
  fail "8/8 secret files found in the image filesystem: $(echo "$fs_hits" | tr '\n' ' ')"
fi

echo
if [ "$failures" -ne 0 ]; then
  printf '✗ assert-image failed: %s check(s) failed\n' "$failures" >&2
  exit 1
fi
printf '✓ all 8 image assertions passed\n'
