# Deferred items — phase 03-runtime

Out-of-scope discoveries. Not fixed here; logged so they are not lost.

## From 03-02 (PORT naming sweep)

- `examples/home-assistant-app/homeweave_app/Dockerfile.example:14` — `ENV APP_PORT=8099`. The
  example predates the `PORT` rename and is not in 03-02's `files_modified`. Same rename applies;
  check whether `docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md` should point at it at the same time.
- `SPEC_BUNDLE.md:1686-1690` — the bundled spec still shows `APP_PORT=8500` and
  `APP_BASE_URL=http://localhost:8500`. Spec bundle, not executable config; left untouched on
  purpose (it is a frozen artifact). Regenerate it or note the drift if it is meant to be current.

## From 03-02 (test coverage gaps)

- No test covers validator check `V20` (watchdog type). `scripts/__tests__/validate-app-metadata.test.mjs`
  is not in 03-02's file list. A `watchdog: true` rejection case is the obvious addition next time
  that file is touched — V20 currently runs only on the real repo tree via `validate:app`.
- `validate-app-metadata.test.mjs:94-104` (the V2 "remaining required keys" loop) enumerates keys
  literally and does not include `watchdog`, so "missing watchdog is rejected" has no dedicated test.
