import { randomUUID } from 'node:crypto';
import { Injectable, type NestMiddleware } from '@nestjs/common';

import { runWithRequestId } from './request-context';

// Assigns one `requestId` per HTTP request, echoes it back in `x-request-id` and binds it
// to the async context so every log line produced while serving the request carries it.
//
// The inbound header is honoured because the Supervisor (and any reverse proxy in front of
// it) may already have assigned an id, and a second, unrelated id in the same trace is
// worse than none. It is honoured *conditionally*: a client-controlled string ends up in
// every log line, so only a strict character class and length window is accepted.
// Anything else — `../`, a newline, a 200-char blob, an array from a repeated header —
// is discarded and replaced with a generated uuid.

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Accepted inbound ids: 8–64 characters of `[A-Za-z0-9-]`.
 *
 * Wide enough for a uuid (36) and for the Supervisor's prefixed ids, narrow enough that
 * the value cannot carry whitespace, a newline (log-injection) or a path segment.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** The parts of Express's request/response this middleware touches. */
export interface RequestWithHeaders {
  readonly headers: Record<string, string | string[] | undefined>;
}

export interface ResponseWithHeaders {
  setHeader(name: string, value: string): void;
}

@Injectable()
export class RequestIdMiddleware
  implements NestMiddleware<RequestWithHeaders, ResponseWithHeaders>
{
  use(req: RequestWithHeaders, res: ResponseWithHeaders, next: (error?: unknown) => void): void {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);

    // Before `next()`: a handler that throws must still produce a response carrying the
    // id, otherwise the 500 the operator is reading cannot be matched to a log line.
    res.setHeader(REQUEST_ID_HEADER, requestId);

    // `next()` runs *inside* the scope so the router chain it synchronously starts — and
    // every continuation of it, `await`s included — sees the same id.
    runWithRequestId(requestId, () => next());
  }
}

/** The inbound id when it is safe to reuse, otherwise a fresh uuid. */
function resolveRequestId(inbound: string | string[] | undefined): string {
  if (typeof inbound === 'string' && REQUEST_ID_PATTERN.test(inbound)) return inbound;
  // A repeated header arrives as an array, which is dropped by the guard above rather than
  // silently joined: two ids for one request means the caller is confused about the trace.
  return randomUUID();
}
