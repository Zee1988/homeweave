import { AsyncLocalStorage } from 'node:async_hooks';

// The correlation half of D-03: one `requestId` per HTTP request, readable from any depth
// of the call stack without threading a parameter through every service.
//
// Why AsyncLocalStorage rather than a request-scoped Nest provider: a request-scoped
// provider makes *its consumers* request-scoped too, and a singleton that injects one
// silently becomes per-request — the Prisma client would be re-instantiated per call.
// ALS carries the value through `await` boundaries for free and costs nothing when unused.
//
// This module holds no state of its own beyond the storage instance, imports nothing from
// Nest and nothing from pino, so both the logger core and its unit test can depend on it.
export interface RequestContext {
  readonly requestId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with `requestId` bound to the async context it creates.
 *
 * Everything `fn` synchronously triggers — and every continuation of that work, including
 * the `await`s inside a Nest handler — sees the same `requestId`.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/** The current request's id, or `undefined` outside a `runWithRequestId` scope. */
export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
