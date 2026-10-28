import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';

import { AppModule, setAppLogLevel } from './app.module';
import { loadAppConfig } from './config/app-config';
import { PinoLoggerService } from './logging/pino-logger.service';

async function bootstrap(): Promise<void> {
  // Everything the process needs is resolved before the container exists, so a bad
  // PORT fails here rather than inside a Nest provider where the error would surface
  // as an opaque "Nest can't resolve dependencies" message (03-RESEARCH.md §8.1).
  // 03-05 adds the remaining fail-fast checks (writable /data, migration state) at this
  // same point, before `NestFactory.create`.
  const config = loadAppConfig();
  setAppLogLevel(config.logLevel);

  // bufferLogs holds Nest's own bootstrap lines until `useLogger` installs the pino
  // writer, otherwise the first few records are printed in Nest's default format and
  // the log stream has two incompatible shapes in it.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLoggerService));

  // 0.0.0.0, not localhost: the Supervisor's watchdog reaches the app from outside the
  // container's loopback interface.
  await app.listen(config.port, '0.0.0.0');

  // One startup record, and the only place these three values are printed. `port` comes
  // from the resolved config rather than from the HTTP server, so it is what the app was
  // told to bind, not what a previous phase happened to default to. `databasePath` is
  // printed instead of `databaseUrl`: this phase's URL carries no credentials, but the
  // path is the half an operator can actually act on (03-05 turns it into a disk check).
  app.get(PinoLoggerService).log(
    {
      port: config.port,
      databasePath: config.databasePath,
      logLevel: config.logLevel,
      logLevelSource: config.logLevelSource,
    },
    'Bootstrap',
  );
}

void bootstrap();
