import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { finalizeBooking } from './_lib/finalizeBooking.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await checkRateLimit(`notify:${getClientIp(req)}`, { maxRequests: 15, windowMinutes: 5 })
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message })
      return
    }
    // Rate-limit infra failing must never block a real booking notification.
    console.error('Rate limit check failed:', err)
    Sentry.captureException(err)
  }

  // Only the booking's own ID is trusted from the client — every other
  // field (recipient, name, reference, services, times) is read straight
  // from Firestore's real record. Trusting the request body directly here
  // would let anyone POST arbitrary content to be emailed to any address
  // "from" this practice's real sender, or overwrite a real booking's
  // calendar/confirm fields.
  const { bookingId } = req.body
  if (typeof bookingId !== 'string' || !bookingId) {
    res.status(400).json({ error: 'Missing bookingId' })
    return
  }

  const bookingRef = adminDb.collection('bookings').doc(bookingId)
  const snap = await bookingRef.get()
  if (!snap.exists) {
    res.status(404).json({ error: 'Booking not found' })
    return
  }
  const booking = snap.data()

  // Idempotent by design: bookingId isn't actually secret (bookingSlots is
  // publicly readable, so any bookingId can be read off it), so this route
  // has to be safe to call more than once for the same booking — a replay
  // must be a no-op, not a second real email and a second calendar event.
  if (booking.notifiedAt) {
    res.status(200).json({ ok: true })
    return
  }

  // This route is still public and unauthenticated, and bookingId is
  // discoverable via the public bookingSlots collection — without this
  // check, anyone could call it directly to get the "you're confirmed"
  // email and calendar event sent for a booking whose deposit was never
  // actually paid, bypassing the entire point of requiring one. Bookings
  // created before deposits existed have no depositStatus at all and are
  // unaffected.
  if (booking.depositStatus && booking.depositStatus !== 'paid') {
    res.status(200).json({ ok: true })
    return
  }

  await finalizeBooking(bookingRef, booking, bookingId)

  // Always respond success — a failed notification must never look like a failed booking.
  res.status(200).json({ ok: true })
}
