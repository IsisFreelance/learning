import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { tokensMatch } from './_lib/tokens.js'
import { isBookingPast } from '../src/lib/scheduling.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await checkRateLimit(`manage-booking:${getClientIp(req)}`, { maxRequests: 15, windowMinutes: 5 })
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message })
      return
    }
    console.error('Rate limit check failed:', err)
    Sentry.captureException(err)
  }

  const { bookingId, token } = req.query
  if (typeof bookingId !== 'string' || !bookingId || typeof token !== 'string' || !token) {
    res.status(400).json({ error: 'Missing bookingId or token' })
    return
  }

  const snap = await adminDb.collection('bookings').doc(bookingId).get()

  // Same generic response whether the booking doesn't exist or the token is
  // wrong — a failed guess should never reveal which reason it failed for.
  if (!snap.exists || !tokensMatch(token, snap.data().manageToken)) {
    res.status(404).json({ error: 'Link not found or expired' })
    return
  }

  const booking = snap.data()

  if (booking.status === 'Cancelled') {
    res.status(410).json({ error: 'This booking has already been cancelled.' })
    return
  }
  if (isBookingPast(booking)) {
    res.status(410).json({ error: 'This appointment has already happened.' })
    return
  }

  res.status(200).json({
    reference: booking.reference,
    services: booking.services,
    totalMinutes: booking.totalMinutes,
    date: booking.date,
    startTime: booking.startTime,
    endTime: booking.endTime,
    status: booking.status,
    name: booking.name,
    proposedDate: booking.proposedDate || null,
    proposedStartTime: booking.proposedStartTime || null,
    proposedEndTime: booking.proposedEndTime || null,
  })
}
