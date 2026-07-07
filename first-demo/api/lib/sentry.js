import * as Sentry from '@sentry/node'

// Initialized once per cold start; warm invocations reuse this. Each
// serverless function imports this file first so errors get captured
// regardless of which endpoint they happen in.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0,
})

export default Sentry
