import { existsSync, statfsSync } from 'node:fs';

// Free-space dimension of readiness.
//
// The target directory is derived by the caller from `databasePathFromUrl()` — one
// interpretation of `DATABASE_URL` for the adapter, the write probe and this check alike
// (03-04-PLAN.md key_links). Nothing here parses a URL.
//
// Two failure modes must stay distinguishable, because they need different operator
// actions: "the volume is not mounted / the directory is gone" (a mount problem) versus
// "the volume is nearly full" (a retention problem). A single opaque `low` would send an
// operator looking at the wrong thing, so `reason` carries the difference.
//
// No `@nestjs/*` import and no decorators: `--experimental-strip-types` loads this module
// directly for the unit tests.

/** 10 MiB. Below this, SQLite cannot reliably finish a WAL checkpoint, let alone a
 *  migration — the number is a floor for "still able to persist", not a capacity plan. */
export const DEFAULT_DISK_MIN_FREE_BYTES = 10 * 1024 * 1024;

export type DiskStatus = 'ok' | 'low';

/** `dir_missing` = entrypoint is wrong or the volume is not mounted.
 *  `stat_failed` = the directory exists but the filesystem refused to report free space
 *  (an I/O or permissions problem that `existsSync` cannot see). */
export type DiskReason = 'dir_missing' | 'stat_failed';

export interface DiskCheckResult {
  status: DiskStatus;
  freeBytes: number;
  reason?: DiskReason;
}

/** Only the two syscalls the check needs, so tests can drive the numbers directly. */
export interface DiskIo {
  exists: (path: string) => boolean;
  statfs: (path: string) => { bsize: number; bavail: number };
}

export const defaultDiskIo: DiskIo = {
  exists: (path) => existsSync(path),
  statfs: (path) => statfsSync(path),
};

/**
 * `DISK_MIN_FREE_BYTES` override.
 *
 * A malformed value falls back to the default instead of throwing: readiness is the one
 * endpoint that must still answer when the configuration is wrong (a typo in an add-on
 * option would otherwise turn every probe into a 500 and hide the real problem).
 */
export function resolveDiskThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DISK_MIN_FREE_BYTES;
  if (raw === undefined || raw.trim().length === 0) return DEFAULT_DISK_MIN_FREE_BYTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_DISK_MIN_FREE_BYTES;

  return parsed;
}

/**
 * `freeBytes = bsize * bavail` — free blocks available to an unprivileged process, not
 * `bfree` (total free blocks, which includes the root reserve). `USER node` in the image
 * is exactly an unprivileged process, so `bfree` would overstate what the app can use.
 */
export function checkDisk(
  dir: string,
  thresholdBytes: number = resolveDiskThreshold(),
  io: DiskIo = defaultDiskIo,
): DiskCheckResult {
  if (!io.exists(dir)) return { status: 'low', freeBytes: 0, reason: 'dir_missing' };

  let stats;
  try {
    stats = io.statfs(dir);
  } catch {
    return { status: 'low', freeBytes: 0, reason: 'stat_failed' };
  }

  const freeBytes = stats.bsize * stats.bavail;

  return freeBytes < thresholdBytes ? { status: 'low', freeBytes } : { status: 'ok', freeBytes };
}
