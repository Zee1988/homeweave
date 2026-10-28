// Runtime DATABASE_URL resolution.
//
// Resolution order (mirrors apps/api/prisma.config.ts, so the CLI and the running
// process never disagree about which file gets opened):
//   1. DATABASE_URL from the environment (CI, container, exported shell var)
//   2. the container default below
//
// The default differs from prisma.config.ts on purpose: that file is executed by
// developers running `prisma migrate` on a laptop (local-dev default
// `file:./data/app.db`), while this module only runs inside the shipped container,
// where the database lives on the Home Assistant App persistent volume
// (`DATABASE_URL=file:/data/homeweave.db` — see
// docs/21_HOME_ASSISTANT_APP_DEPLOYMENT.md:105).
//
// No `dotenv` dependency: Prisma 7 no longer auto-loads `.env`, and the runtime must
// not add a package just to read one variable.
export const DEFAULT_DATABASE_URL = 'file:/data/homeweave.db';

/** The connection URL the Prisma driver adapter is constructed with. */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.DATABASE_URL;
  if (typeof raw !== 'string' || raw.trim().length === 0) return DEFAULT_DATABASE_URL;
  return raw;
}

// This is NOT a re-implementation of the adapter's URL handling. It exists only so
// the readiness disk/database checks (03-04) look at exactly the same filesystem
// path the adapter opens. The rule of record is `url.replace(/^file:/, '')` inside
// @prisma/adapter-better-sqlite3 (dist/index.js, createBetterSQLite3Client); keep
// this in lockstep with it and never introduce a second interpretation of the URL.
//
// A relative result (`file:./data/app.db` -> `./data/app.db`) resolves against
// process.cwd(), which is exactly what better-sqlite3 does. Callers that need an
// absolute path should resolve it once at their own call site.
export function databasePathFromUrl(url: string): string {
  return String(url).replace(/^file:/, '');
}
