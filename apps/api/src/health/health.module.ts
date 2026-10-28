import { dirname, resolve } from 'node:path';

import { Logger, Module } from '@nestjs/common';

import { databasePathFromUrl, resolveDatabaseUrl } from '../config/database-url';
import { ShutdownStateModule } from '../lifecycle/shutdown-state';
import { PrismaService } from '../prisma/prisma.service';
import { probeWritableOnce, WriteProbeError, type StartupProbeHolder } from './checks/database.check';
import { DATABASE_DIR, MIGRATIONS_DIR, STARTUP_PROBE } from './health-checks';
import { HealthController } from './health.controller';

// HealthModule still does not import PrismaModule: it is `@Global()`, so the single
// PrismaService is already injectable, and importing it here would suggest a second
// connection could be created.
//
// The three tokens below exist so the checks receive their inputs explicitly instead of
// re-reading `process.env` inside a check. The directory is derived once, at container
// creation, from the same `databasePathFromUrl()` the adapter's path comes from — a
// second interpretation of `DATABASE_URL` is how a readiness probe ends up statfs-ing a
// directory the database does not live in.
@Module({
  imports: [ShutdownStateModule],
  controllers: [HealthController],
  providers: [
    {
      provide: DATABASE_DIR,
      // `path.resolve` because better-sqlite3 resolves a relative path against
      // process.cwd(), and `dirname()` of an unresolved `./data/app.db` would be `.`
      // (which is fine) but of `data/app.db` would be `data` (which is not the same
      // directory once the cwd differs). Resolving first makes both cases identical.
      useFactory: (): string => dirname(resolve(databasePathFromUrl(resolveDatabaseUrl(process.env)))),
    },
    {
      provide: MIGRATIONS_DIR,
      // `prisma/` is copied to the image root and `WORKDIR` is `/app`, so the default is
      // cwd-relative for the same reason `dist/main.js` is: both start from the cwd the
      // Supervisor sets. `MIGRATIONS_DIR` exists for tests and for a relocated image.
      useFactory: (): string => resolve(process.env.MIGRATIONS_DIR ?? 'prisma/migrations'),
    },
    {
      provide: STARTUP_PROBE,
      inject: [PrismaService, DATABASE_DIR],
      useFactory: (prisma: PrismaService, databaseDir: string): StartupProbeHolder => {
        const logger = new Logger('StartupDatabaseProbe');
        const holder: StartupProbeHolder = {
          // Fail-closed until `onModuleInit` has actually run. Nest runs module init
          // before `listen()` returns, so no request can observe this value — but if a
          // future refactor skips the hook, readiness must not claim "writable" without
          // having written anything.
          state: { ok: false, reason: 'write_failed' },
          async onModuleInit(): Promise<void> {
            try {
              await probeWritableOnce(prisma, databaseDir);
              holder.state = { ok: true };
              logger.log({ databaseDir }, 'database write probe passed');
            } catch (error) {
              // Never rethrow: a non-writable volume must leave the process able to
              // answer `/health/ready` with 503 and a cause. Exiting here is 03-05's
              // decision (exit 78), taken once, in one place, from the same probe state.
              const reason = error instanceof WriteProbeError ? error.reason : 'write_failed';
              holder.state = { ok: false, reason };
              logger.warn(
                { databaseDir, reason },
                'database write probe failed — /health/ready will answer 503',
              );
            }
          },
        };

        return holder;
      },
    },
  ],
})
export class HealthModule {}
