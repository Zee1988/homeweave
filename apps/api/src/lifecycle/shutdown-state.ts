import { Injectable, Module } from '@nestjs/common';

// The one piece of shutdown state readiness needs, kept in its own module so that
// 03-04 (readiness) and 03-05 (graceful shutdown) share a single instance without
// importing each other. 03-05 imports this module and calls `beginShutdown()` at the
// top of its SIGTERM handler; `/health/ready` reads `shuttingDown` and stops advertising
// the container as ready immediately, which is the whole point of a two-probe setup:
// the Supervisor stops routing to a process that is about to stop listening, while
// `/health/live` keeps answering 200 so the watchdog does not kill it mid-drain.
//
// A module, not a `@Global()`: exactly two modules need it, and an implicit global would
// make it easy to introduce a second instance by providing the class again somewhere.
@Injectable()
export class ShutdownState {
  private flag = false;

  get shuttingDown(): boolean {
    return this.flag;
  }

  /** Idempotent: a second SIGTERM must not change anything. */
  beginShutdown(): void {
    this.flag = true;
  }
}

@Module({
  providers: [ShutdownState],
  exports: [ShutdownState],
})
export class ShutdownStateModule {}
