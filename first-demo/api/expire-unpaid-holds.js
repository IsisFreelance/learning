import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { stripe } from './_lib/stripeClient.js'
import { computeSlotKeys, hhmmToMinutes } from '../src/lib/scheduling.js'

const HOLD_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2 hours — comfortably longer than
// the 1-hour Stripe Checkout Session expiry (api/create-checkout-session.js),
// so a session can never still be payable by the time this considers it abandoned.

export default async function handler(req, res) {
  const authHeader = req.headers.authorization
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // A single-field `in` query, filtered by age in memory afterward —
  // avoids needing a new Firestore composite index (depositStatus +
  // createdAt together) for what's a small, once-a-day cleanup job.
  const snap = await adminDb.collection('bookings').where('depositStatus', 'in', ['unpaid', 'pending_payment']).get()

  const cutoff = Date.now() - HOLD_TIMEOUT_MS
  let expired = 0

  for (const doc of snap.docs) {
    const booking = doc.data()
    if (!booking.createdAt || booking.createdAt.toMillis() > cutoff) continue

    try {
      const slotKeys = computeSlotKeys(booking.date, hhmmToMinutes(booking.startTime), booking.totalMinutes)
      const batch = adminDb.batch()
      for (const key of slotKeys) {
        batch.delete(adminDb.collection('bookingSlots').doc(key))
      }
      batch.delete(doc.ref)
      await batch.commit()

      // Best-effort — Stripe already auto-expires the session on its own
      // after an hour, so this just tidies it up a little earlier.
      if (booking.stripeCheckoutSessionId) {
        try {
          await stripe.checkout.sessions.expire(booking.stripeCheckoutSessionId)
        } catch {
          // Already expired/completed — nothing to do.
        }
      }

      expired += 1
    } catch (err) {
      console.error(`Failed to expire unpaid hold for booking ${doc.id}:`, err)
      Sentry.captureException(err)
    }
  }

  res.status(200).json({ ok: true, expired })
}
