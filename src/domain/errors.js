// Single error-normalization layer (Director-mandated 2026-09-11) -- maps
// predictable D1/SQLite constraint failures to useful client responses,
// without exposing raw SQL, table names, or stack traces. Any error not
// recognized here stays a 500 (fail loud on the truly unexpected).
import { ValidationError, ConfirmationRequired } from './validation.js';

const D1_ERROR_PATTERNS = [
  { test: /FOREIGN KEY constraint failed/i, status: 400, message: 'Referenced resource does not exist.' },
  { test: /UNIQUE constraint failed/i, status: 409, message: 'This resource already exists or conflicts with an existing one.' },
];

export function toErrorResponse(err) {
  if (err instanceof ConfirmationRequired) {
    return Response.json({ error: err.message, warnings: err.warnings, requiresAcknowledgement: true }, { status: 409 });
  }
  if (err instanceof ValidationError) {
    return Response.json({ error: err.message }, { status: 400 });
  }

  const message = String(err && err.message ? err.message : err);
  for (const pattern of D1_ERROR_PATTERNS) {
    if (pattern.test.test(message)) {
      return Response.json({ error: pattern.message }, { status: pattern.status });
    }
  }

  // Unknown/unexpected -- do not leak internals, but do not disguise it as
  // a client error either. Logged server-side via console.error so it's
  // visible in `wrangler tail`, never in the response body.
  console.error('Unhandled error:', err);
  return Response.json({ error: 'Internal server error.' }, { status: 500 });
}
