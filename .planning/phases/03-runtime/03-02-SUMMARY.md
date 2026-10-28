---
phase: 03-runtime
plan: "02"
subsystem: build-probes-and-app-packaging
tags: [watchdog, ha-app, generator, validator, port-naming, prisma-probe]
status: complete
requires: []
provides:
  - "watchdog: http://[HOST]:[PORT:8099]/health/live in homeweave_app/config.yaml, emitted from app-metadata.json"
  - "V20 validation: watchdog must be an http(s) URL string on [PORT:8099]; booleans rejected"
  - "PORT (not APP_PORT) as the single env-var name for the API listening port"
  - "NATIVE_MODULES row in the Prisma engine probe (Task 1, prior session)"
affects:
  - "03-05 assert-image.sh check 9 consumes /health/live and reuses NATIVE_MODULES"
tech-stack:
  added: []
  patterns:
    - "generated-artifact single source of truth (app-metadata.json -> generate -> config.yaml, --check zero-diff)"
    - "fail-closed config validation (collected failures, no fail-fast, one code per assertion)"
key-files:
  created: []
  modified:
    - scripts/probe-prisma-engine.mjs
    - scripts/probe-prisma-engine.test.mjs
    - scripts/generate-app-metadata.mjs
    - scripts/validate-app-metadata.mjs
    - scripts/__tests__/generate-app-metadata.test.mjs
    - scripts/__tests__/fixtures.mjs
    - homeweave_app/app-metadata.json
    - homeweave_app/config.yaml
    - .env.example
    - docs/14_ENV_AND_DEPLOYMENT.md
decisions:
  - "watchdog sits immediately after ingress_port and before options/schema"
  - "watchdog is a required key, not merely an allowed one (required == allowed stays intact)"
  - "APP_BASE_URL follows to :8099 in the same edit as APP_PORT -> PORT"
  - "generate-app-metadata.mjs gains no source-side watchdog type guard; V20 owns the type"
commits: 4
plan_head_before: 48d30f5d98acda50f7e45216a32787326213049c
plan_head_after: 0b3897d8d54d53d6875621bb944870bc44f6339c
actuals:
  tokens: 8200
  tasks: 4
  commits: 4
metrics:
  duration: "~25 min continuation (Task 1 ran in a previous, context-exhausted session)"
  completed: "2026-10-28"
  files_changed: 10
  insertions: 542
  deletions: 18
  tests: "231 (test:app), 20 (probe), 27 (validate-dockerfile)"
---

# Phase 03 Plan 02: 探针语义收窄与 watchdog 生成链 — Summary

**One-liner:** HA App now ships a `watchdog` URL on `[PORT:8099]/health/live`, generated from `app-metadata.json` and pinned by a new fail-closed `V20` type check, while the Prisma probe reports the engine binary and other native modules as separate facts instead of one blanket `RUST_FREE`.

## What was executed

| Task | What landed | Commit |
|------|-------------|--------|
| 1 | Prisma probe narrowed: `RUST_FREE` now scoped to the engine binary, `NATIVE_MODULES` lists everything else (better-sqlite3), `RUST_FREE_SCOPE` emitted | `942256d` |
| 2 | `watchdog` wired through the whole generation chain + `V20` validator check | `523f6df` |
| 3 | The tests Task 2 broke: unconsumed-key counter-example moved off `watchdog`, fixtures baseline extended | `0c27c21` |
| 4 | `APP_PORT=8500` → `PORT=8099` in `.env.example` and `docs/14` | `0b3897d` |

Task 1 was completed and committed by a previous executor that exhausted its context. It was **not** redone or reverted; its `<automated>` block was re-run once in this session to confirm it is still green (20/20 pass).

## Resolved decision: where `watchdog` goes in the key order

`01-PATTERNS.md` §键序契约 fixes this sequence and declares any reordering a defect:

```
name → slug → version → description → url → arch → init → image
→ homeassistant → homeassistant_api → ingress → ingress_port
→ options → schema
```

`watchdog` is not in that list — the contract predates D-13. The chosen slot is **immediately after `ingress_port`, before `options`**, for three reasons:

1. **It disturbs nothing.** Every key the contract actually names keeps its recorded relative position, so the contract's real invariant (no meaningless regeneration diff) is untouched. Appending at the tail would have moved `options`/`schema`; prepending would have moved everything.
2. **It is the semantically adjacent slot.** `ingress_port` is the port Supervisor proxies to; `watchdog` is the URL Supervisor probes on that same port. Someone editing one is looking straight at the other, which is the whole point of putting them together.
3. **It matches the generated artifact's own logic.** The ingress trio (`ingress`, `ingress_port`, `watchdog`) reads as one block, then the options tail.

The decision is recorded as a comment in `buildConfigYaml()` so the next person does not "fix" the order back. No test asserts on line order — `check:app`'s zero-diff does, effectively, by freezing whatever order the generator emits.

## Verification (real output, this machine: Windows 11 + PowerShell 7, Node v22.17.0)

| # | Command | Observed result |
|---|---------|-----------------|
| 1 | Task 1 `<automated>`: `node --test "scripts/probe-prisma-engine.test.mjs"` (re-run) | `tests 20 / pass 20 / fail 0`, exit 0 |
| 2 | Task 2 `<automated>`: `corepack pnpm@9.15.4 generate:app; corepack pnpm@9.15.4 check:app; node -e "…watchdog…"` | `ok http://[HOST]:[PORT:8099]/health/live`, exit 0; `check:app` printed no diff |
| 3 | `corepack pnpm@9.15.4 validate:app` | `✓ 91 checks passed` |
| 4 | Task 3 `<automated>`: `corepack pnpm@9.15.4 test:app` | `tests 231 / pass 231 / fail 0`, exit 0 |
| 5 | Task 4 `<automated>`: `node -e "…APP_PORT/PORT=8099…"; corepack pnpm@9.15.4 run test:app` | `ok`; `tests 231 / pass 231 / fail 0` |
| 6 | **FINAL GATE** `corepack pnpm@9.15.4 test:app` | `pass 231 / fail 0`, exit 0 |
| 7 | **FINAL GATE** `corepack pnpm@9.15.4 check:app` | exit 0, zero diff |
| 8 | `corepack pnpm@9.15.4 validate:dockerfile` | `✓ dockerfile checks passed (22 rules)` |
| 9 | `node --test scripts/validate-dockerfile.test.mjs` | `tests 27 / pass 27 / fail 0` |

Generated artifact (excerpt from `homeweave_app/config.yaml`):

```yaml
ingress: true
ingress_port: 8099
watchdog: "http://[HOST]:[PORT:8099]/health/live"
options:
  log_level: info
```

`scalar()` quotes it because the URL contains `:`/`[`/`]`, outside `PLAIN_SCALAR` — so the string round-trips exactly and js-yaml parses it as a string, not as `true`/a mapping.

## Skipped checks (could not run here — not claimed as passes)

| Check | Why skipped |
|-------|-------------|
| `scripts/ci/assert-image.sh` (all of it) | Bash script; this machine has no bash and no Docker. Its 8→9 check renumbering is 03-05 work. |
| `docker build` / image health-endpoint assertion | No Docker on Windows. The real "image has a health endpoint" assertion is explicitly deferred to 03-05 per the plan. |
| arm64 (QEMU) smoke | No Docker / no emulation available. |
| `.github/workflows` execution | CI-only; `validate:workflows` is covered indirectly by the 231-test run, not executed as a workflow. |

## Deviations from Plan

### 1. [Rule 1 — Bug] `APP_BASE_URL` port followed `APP_PORT` → `PORT`

- **Found during:** Task 4
- **Issue:** The plan named only `APP_PORT=8500` → `PORT=8099`. But `.env.example` also carried `APP_BASE_URL=http://localhost:8500`, which was *consistent* with the old name. Renaming only the port variable would have left a base URL pointing at a port nothing listens on — a fresh inconsistency introduced by this very edit.
- **Fix:** `APP_BASE_URL=http://localhost:8099`, same file, same commit.
- **Files:** `.env.example`, `docs/14_ENV_AND_DEPLOYMENT.md`
- **Commit:** `0b3897d`

### 2. [Rule 1 — Bug] The Task-4 gate caught my own comment

- **Found during:** Task 4, first verification run
- **Issue:** The first draft of the explanatory comment in `.env.example` said "the old prefixed name had no consumer" but named the token literally — and the plan's `<fails_when>` is `/APP_PORT/` against the raw file text. The gate fired: `APP_PORT still present`.
- **Fix:** Reworded the comment to describe the old name without spelling it. The gate is stricter than its stated intent, and it is right: the file should contain no trace of the old name for a `grep`-based reader either.
- **Files:** `.env.example`
- **Commit:** `0b3897d`

### 3. [Rule 2 — Comment truthfulness] Stale `app.watchdog = true` counter-examples

- **Found during:** Task 2 (`generate-app-metadata.mjs:322-324`) and Task 3 (test header comment)
- **Issue:** Both comments taught the "unconsumed key" rule with `app.watchdog = true` — the exact key that just became legal. A comment that documents a counter-example which now succeeds is worse than no comment.
- **Fix:** Both now use `watchdogUrl`, which is still never read by the generator.
- **Files:** `scripts/generate-app-metadata.mjs`, `scripts/__tests__/generate-app-metadata.test.mjs`
- **Commits:** `523f6df`, `0c27c21`

### 4. Deliberate non-changes

- **`scripts/validate-dockerfile.mjs` / `.test.mjs`: zero diff.** The plan authorised a message-text edit only *if* the test required it. `validate-dockerfile.test.mjs:243` asserts `/no HTTP endpoint until Phase 3/` and the implementation's D9 message already contains that phrase; the test is green untouched. Changing D9's *semantics* is 03-05's job (the image gains `/health/live` there).
- **`homeweave_app/repository.yaml`: no content change.** It is listed in `files_modified` and the generator rewrites it on every run, but the bytes are identical (same blob hash before and after). `git status` briefly reported `M` from a stale stat cache; `git add` cleared it with nothing to commit.
- **No source-side type guard for `app.watchdog` in the generator.** `scalar()` would happily stringify `watchdog: true` as `true`. The guard lives in V20 instead, which is the layer that already owns per-key type contracts (V9 booleans, V10 port range). Duplicating it in the generator would create a second place to keep in sync, which is the exact failure mode `CONFIG_REQUIRED_KEYS` being derived exists to prevent.

## Deferred / out of scope

- `examples/home-assistant-app/homeweave_app/Dockerfile.example:14` still has `ENV APP_PORT=8099`, and `SPEC_BUNDLE.md:1688` still shows `APP_PORT=8500`. Neither is in this plan's `files_modified`, so both were left alone. Logged in `deferred-items.md`.
- No test yet covers V20 directly (`scripts/__tests__/validate-app-metadata.test.mjs` is not in this plan's file list, and its V2 loop enumerates required keys literally). V20 is exercised only through the happy path: `validate:app` on the real tree. Worth a `watchdog: true` rejection case next time that file is touched.
- The `V2` required-key loop in `validate-app-metadata.test.mjs:94-104` does not include `watchdog`, so "missing watchdog is rejected" is asserted only indirectly (by V2 in production, not by a test).

## Context-exhaustion handoff

The previous executor ran out of budget after committing Task 1 (`942256d`) and before touching Tasks 2-4. Handoff was clean: working tree clean, Task 1 self-contained and green, plan file intact. This continuation read only the plan's Task 2/3/4 region, `01-PATTERNS.md`'s key-order contract, `03-PATTERNS.md` §回归陷阱, the named code regions, and `03-RESEARCH.md §9.1/§9.2` — not the whole research document.

Nothing in the phase is left half-written: every task in this plan ends at a commit boundary, and both final gates are green.

## Self-Check: PASSED

- `homeweave_app/app-metadata.json` contains `watchdog` — FOUND
- `homeweave_app/config.yaml` contains `watchdog: "http://[HOST]:[PORT:8099]/health/live"` — FOUND
- `scripts/__tests__/fixtures.mjs` contains the byte-identical watchdog string — FOUND
- `.env.example` contains `PORT=8099` and no `APP_PORT` — FOUND
- Commits `942256d`, `523f6df`, `0c27c21`, `0b3897d` all ancestors of HEAD — FOUND
- `corepack pnpm@9.15.4 test:app` → 231 pass / 0 fail — OBSERVED
- `corepack pnpm@9.15.4 check:app` → exit 0, zero diff — OBSERVED
