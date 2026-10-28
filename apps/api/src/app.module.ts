import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import type { LogLevel } from './config/log-level';
import { HealthModule } from './health/health.module';
import { ShutdownModule } from './lifecycle/shutdown.service';
import { PinoLoggerService } from './logging/pino-logger.service';
import { RequestIdMiddleware } from './logging/request-id.middleware';
import { PrismaModule } from './prisma/prisma.module';

// The log level is resolved exactly once, by `loadAppConfig()` in main.ts, and handed
// over here before the container is created (D-09: a setting that is resolved twice is
// a setting that can diverge). The holder is deliberately module state and not a
// re-read of process.env — PrismaModule already re-reads DATABASE_URL, and widening
// that pattern is how the process ends up logging at one level and filtering at another.
let logLevel: LogLevel = 'info';

/** Called by main.ts before `NestFactory.create`. */
export function setAppLogLevel(level: LogLevel): void {
  logLevel = level;
}

@Module({
  imports: [PrismaModule, HealthModule, ShutdownModule],
  providers: [
    {
      provide: PinoLoggerService,
      // A factory rather than a bare class provider: the constructor takes options, and
      // the emitted `design:paramtypes` metadata would make Nest try to resolve that
      // options object as an injection token.
      useFactory: (): PinoLoggerService => new PinoLoggerService({ level: logLevel }),
    },
  ],
  exports: [PinoLoggerService],
})
export class AppModule implements NestModule {
  /**
   * Applied to every route (`'*'`) and registered first, so nothing downstream — another
   * middleware, a guard, a handler, an exception filter — can log a line that lacks the
   * `requestId` the response advertises in `x-request-id`.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
