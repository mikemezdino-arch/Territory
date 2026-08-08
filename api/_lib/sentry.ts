import * as Sentry from "@sentry/node";

// Lazy, idempotent init so every route can just call captureError() in its
// catch block without each one needing its own init boilerplate. No-ops
// entirely until SENTRY_DSN is set, so this is safe to leave wired up
// before the Sentry project/DSN actually exists.
let initialized = false;

function ensureInit() {
  if (initialized || !process.env.SENTRY_DSN) return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || "development",
    tracesSampleRate: 0,
  });
  initialized = true;
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!process.env.SENTRY_DSN) return;
  ensureInit();
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
