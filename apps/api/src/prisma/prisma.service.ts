import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

import { resolveDatabaseUrl } from '../config/database-url';
import { PrismaClient } from '../generated/prisma/client';

// Prisma 7 requires a driver adapter — there is no engine-free fallback path
// (apps/api/src/generated/prisma/internal/prismaNamespace.ts:694-722: "A driver
// adapter is **required** unless you connect ... through Prisma Accelerate").
//
// Two facts that are easy to get wrong here:
//
// 1. `DATABASE_URL` is passed through verbatim, `file:` prefix included. The adapter
//    strips that scheme itself (one anchored removal inside its dist/index.js before
//    better-sqlite3 opens the path). Hand-rolling the strip here would open a file
//    literally named `data:/...` in the working directory — see 03-RESEARCH.md §4.3
//    and the prohibition in 03-PATTERNS.md §5. Do not add a strip helper: the path
//    parsing that the readiness check needs lives in config/database-url.ts.
//
// 2. `better-sqlite3` IS a native module. The repo's RUST_FREE decision only means the
//    Prisma *query engine* no longer ships a platform binary; the SQLite driver
//    underneath is a .node addon (03-RESEARCH.md §4.4). Do not read RUST_FREE as
//    "no native code".
//
// Connection lifecycle: `$connect()` runs in onModuleInit and `$disconnect()` in
// onModuleDestroy. `process.on('SIGTERM')` must never be registered by hand — Nest's
// shutdown hooks own the signal and a second handler would double-disconnect
// (03-RESEARCH.md §7.1).
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(databaseUrl: string = resolveDatabaseUrl(process.env)) {
    super({ adapter: new PrismaBetterSqlite3({ url: databaseUrl }) });
  }

  // Deliberately not in the constructor: Nest's init order and the fail-fast checks in
  // 03-05 both need a single, observable point where the connection is established.
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
