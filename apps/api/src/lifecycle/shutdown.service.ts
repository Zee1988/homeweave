import { type BeforeApplicationShutdown, Injectable, Logger, Module } from '@nestjs/common';

import { ShutdownState, ShutdownStateModule } from './shutdown-state';

// Graceful shutdown, wired to the one flag readiness already reads.
//
// The order Nest 12.3 actually executes (nest-application-context.js
// `runShutdownSequence`, verified in node_modules rather than assumed):
//
//   1. onModuleDestroy        (all modules)
//   2. beforeApplicationShutdown  <- this class flips the flag here
//   3. dispose()              closes the HTTP server, i.e. stops accepting sockets
//   4. onApplicationShutdown  <- PrismaService disconnects here
//   5. process.exit(0)        (only with `useProcessExit: true`)
//
// That order is why the plan's "disconnect in onModuleDestroy" was moved to
// `onApplicationShutdown` in PrismaService: `onModuleDestroy` runs *before* the server is
// closed, so disconnecting there would tear the connection out from under requests that are
// still being served, and would also invert the log order the plan asks for.
//
// This class deliberately does not call `server.close()`: `dispose()` does it, and a second
// close would race with Nest's own teardown.

export const SHUTDOWN_BEGIN_MESSAGE = 'shutdown: stop accepting new requests';
export const SHUTDOWN_DISCONNECTED_MESSAGE = 'shutdown: prisma disconnected';
export const SHUTDOWN_FORCED_MESSAGE = 'shutdown: budget exceeded, exiting';

@Injectable()
export class ShutdownService implements BeforeApplicationShutdown {
  /**
   * Nest's static logger, so these lines still reach pino: `main.ts` calls
   * `app.useLogger()`, which is an override of the same singleton. Injecting
   * `PinoLoggerService` is not possible here — it is provided by AppModule, and a module
   * cannot inject from the module that imports it.
   */
  private readonly logger = new Logger('ShutdownService');
  private readonly state: ShutdownState;
  private readonly beginListeners: Array<() => void> = [];
  private started = false;

  constructor(state: ShutdownState) {
    this.state = state;
  }

  /**
   * Registers the caller's backstop (the 8 s budget in `main.ts`).
   *
   * The callback runs once, from `beforeApplicationShutdown`. Registering it from `main.ts`
   * keeps the *number* and `process.exit` at the process entry point — the budget is a
   * property of how the container is stopped (under the 10 s `docker stop` window), not of
   * this module's logic.
   */
  onShutdownBegin(listener: () => void): void {
    if (this.started) {
      // A signal that arrives before registration must not lose its backstop.
      listener();
      return;
    }
    this.beginListeners.push(listener);
  }

  /**
   * Idempotent: Nest calls this once per shutdown sequence, and a second SIGTERM finds the
   * sequence already in flight (the context guards it), but the flag must not be reset or
   * the log duplicated if a future version calls the hook again.
   */
  beforeApplicationShutdown(signal?: string): void {
    if (this.started) return;
    this.started = true;

    // Before the log line, not after: `/health/ready` must stop advertising the container
    // the moment teardown starts, and a log write can block on a full pipe.
    this.state.beginShutdown();

    this.logger.log(
      signal === undefined
        ? SHUTDOWN_BEGIN_MESSAGE
        : `${SHUTDOWN_BEGIN_MESSAGE} (${signal})`,
    );

    for (const listener of this.beginListeners) listener();
  }
}

@Module({
  imports: [ShutdownStateModule],
  providers: [ShutdownService],
  exports: [ShutdownService],
})
export class ShutdownModule {}
