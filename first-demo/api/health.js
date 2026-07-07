import './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'

export default async function handler(req, res) {
  const checks = {}

  // A real, cheap read — this is the core dependency, worth actually
  // validating connectivity and credentials for.
  try {
    await adminDb.collection('counters').doc('bookings').get()
    checks.firestore = 'ok'
  } catch {
    checks.firestore = 'error'
  }

  // SendGrid and Google Calendar just get a "is this configured" check, not
  // a real API call — a flaky third-party blip shouldn't make our own
  // health check fail, and this avoids spending their quota on every ping.
  checks.sendgrid = process.env.SENDGRID_API_KEY && process.env.SENDER_EMAIL ? 'configured' : 'missing'
  checks.googleCalendar =
    process.env.FIREBASE_ADMIN_CLIENT_EMAIL && process.env.FIREBASE_ADMIN_PRIVATE_KEY && process.env.GOOGLE_CALENDAR_ID
      ? 'configured'
      : 'missing'

  const healthy = checks.firestore === 'ok' && checks.sendgrid === 'configured' && checks.googleCalendar === 'configured'

  res.status(healthy ? 200 : 503).json({ ok: healthy, checks })
}
