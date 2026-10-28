import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule, setAppLogLevel } from './app.module';
import { loadAppConfig } from './config/app-config';
import { toStartupFailure, type StartupFailure } from './config/errors';
import type { WriteProbeState } from './health/checks/database.check';
import { MIGRATIONS_DIR, STARTUP_PROBE } from './health/health-checks';
import { assertDataDirWritable, dataDirOf, runStartupChecks } from './lifecycle/startup-checks';
import { PinoLoggerService } from './logging/pino-logger.service';
import { PrismaService } from './prisma/prisma.service';

// Boot order, and why each step sits where it does (03-05 Task 1):
//
//   loadAppConfig()      resolve PORT / DATABASE_URL / LOG_LEVEL before any container
//   NestFactory.create() constructs providers and runs module init — which is where the
//                        write probe fires, once
//   useLogger()          install pino before anything else logs
//   runStartupChecks()   four checks, short-circuit, throw ConfigError/StartupError
//   listen()             ONLY after the checks: no window where the port is open and the
//                        database is unusable
//
// The whole sequence is wrapped so that any failure produces exactly one structured record
// and one exit code. A stack trace on stderr is unreadable to a Supervisor; `reason` is
// the field it can be triaged by.

/**
 * Prints the single failure record and exits.
 *
 * Two writers on purpose: before `NestFactory.create` there is no pino instance yet, and a
 * bad PORT is precisely one of the failures that happens there. Both write to **stdout**
 * because the CI assertion greps the container's stdout for `startup_failed`; splitting
 * failure records across two streams would make that assertion miss every config error.
 */
function failStartup(error: unknown, logger?: PinoLoggerService): never {
  const failure: StartupFailure = toStartupFailure(error);
  // `msg` lives inside the object: the logger core spreads a plain object into top-level
  // fields and would otherwise treat a trailing string as `context`, leaving the line
  // without a message.
  const record = {
    event: 'startup_failed',
    reason: failure.reason,
    exitCode: failure.exitCode,
    msg: failure.message,
  };

  if (logger !== undefined) {
    logger.error(record);
  } else {
    process.stdout.write(
      `${JSON.stringify({
        level: 'error',
        time: new Date().toISOString(),
        service: 'homeweave-api',
        ...record,
      })}\n`,
    );
  }

  // `exit` rather than `exitCode =`: a half-initialised container may still hold handles
  // (the SQLite connection, a Nest timer), and the process must not linger while the
  // Supervisor waits for it to stop.
  process.exit(failure.exitCode);
}

async function bootstrap(): Promise<void> {
  // Only for the `catch`: inside the block the logger is a `const` once the container
  // exists, so no call site has to argue with `undefined`.
  let bootLogger: PinoLoggerService | undefined;

  try {
    const config = loadAppConfig();
    setAppLogLevel(config.logLevel);

    // Before the container, because Prisma's `$connect()` throws inside `app.init()` when
    // the directory is missing — and that throw is indistinguishable from a defect. These
    // two checks are pure `fs` and are what turn a missing bind mount into exit 78.
    assertDataDirWritable(dataDirOf(config));

    // bufferLogs holds Nest's own bootstrap lines until `useLogger` installs the pino
    // writer, otherwise the first few records are printed in Nest's default format and
    // the log stream has two incompatible shapes in it.
    const app = await NestFactory.create(AppModule, { bufferLogs: true });
    const logger = app.get(PinoLoggerService);
    bootLogger = logger;
    app.useLogger(logger);

    // `init()` — not `listen()` — is what runs provider lifecycle hooks, and the write
    // probe lives in one (`STARTUP_PROBE` in HealthModule). Without this call the probe
    // has not run yet and every check below reads its fail-closed initial state, which
    // reports a perfectly writable volume as `write_failed`. `init()` wires middleware and
    // routes but does not bind the port, so this does not open the window that the ordering
    // exists to prevent.
    await app.init();

    const startup = await runStartupChecks({
      config,
      // The probe already ran during module init; its verdict is what decides the exit
      // code, so it is read back rather than repeated.
      startupProbe: app.get<{ state: WriteProbeState }>(STARTUP_PROBE).state,
      migrationsDir: app.get<string>(MIGRATIONS_DIR),
      prisma: app.get(PrismaService),
    });

    // 0.0.0.0, not localhost: the Supervisor's watchdog reaches the app from outside the
    // container's loopback interface.
    await app.listen(config.port, '0.0.0.0');

    // One startup record, and the only place these values are printed. `port` comes from
    // the resolved config rather than the HTTP server, so it is what the app was told to
    // bind. `databasePath` is printed instead of `databaseUrl`: this phase's URL carries
    // no credentials, and the path is the half an operator can act on.
    const record = {
      event: 'startup_ok',
      msg: 'Bootstrap',
      port: config.port,
      databasePath: config.databasePath,
      logLevel: config.logLevel,
      logLevelSource: config.logLevelSource,
      migrations: startup.migrations,
      ...(startup.migrationsDetail === undefined
        ? {}
        : { migrationsDetail: startup.migrationsDetail }),
      diskFreeBytes: startup.disk.freeBytes,
    };

    // A fresh volume legitimately reports `migrations: unknown` (no `_prisma_migrations`
    // table yet), and D-06 keeps that out of the readiness status code. The consequence is
    // that nothing else would ever surface it, so it is warned about here — once, at boot,
    // where it is actionable ("this install has never been migrated").
    if (startup.migrations === 'unknown') {
      logger.warn({
        ...record,
        // ASCII only: a log line is read by `grep` and by HAOS's supervisor, neither of
        // which is guaranteed to be UTF-8, and an em dash arrives as mojibake.
        msg: 'startup: migrations unknown - /health/ready will not report migration state',
        reason: startup.migrationsDetail ?? 'table_missing',
      });
    } else {
      logger.log(record);
    }

    if (startup.disk.status === 'low') {
      logger.warn({
        event: 'startup_disk_low',
        msg: 'startup: free space below DISK_MIN_FREE_BYTES - /health/ready will answer 503',
        freeBytes: startup.disk.freeBytes,
        reason: startup.disk.reason,
      });
    }
  } catch (error) {
    failStartup(error, bootLogger);
  }
}

void bootstrap();
