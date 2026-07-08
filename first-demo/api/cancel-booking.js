import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { stripe } from './_lib/stripeClient.js'
import { deleteCalendarEvent } from './_lib/googleCalendar.js'
import { sendCancellationEmail } from './_lib/sendEmail.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'
import { verifyStaffToken } from './_lib/staffAuth.js'
import { hoursUntilAppointment } from '../src/lib/scheduling.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await checkRateLimit(`cancel:${getClientIp(req)}`, { maxRequests: 15, windowMinutes: 5 })
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message })
      return
    }
    console.error('Rate limit check failed:', err)
    Sentry.captureException(err)
  }

  const authHeader = req.headers.authorization || ''
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null

  if (!idToken || !(await verifyStaffToken(idToken))) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const { bookingId } = req.body
  if (typeof bookingId !== 'string' || !bookingId) {
    res.status(400).json({ error: 'Missing bookingId' })
    return
  }

  const bookingRef = adminDb.collection('bookings').doc(bookingId)
  const snap = await bookingRef.get()
  const booking = snap.exists ? snap.data() : null

  if (!booking) {
    res.status(404).json({ error: 'Booking not found' })
    return
  }

  let calendarDeleted = false
  const hadEvent = Boolean(booking.googleCalendarEventId)
  if (hadEvent) {
    try {
      await deleteCalendarEvent(booking.googleCalendarEventId)
      await bookingRef.update({ googleCalendarEventId: null })
      calendarDeleted = true
    } catch (err) {
      console.error('Failed to delete Google Calendar event:', err)
      Sentry.captureException(err)
    }
  }

  // null = no deposit was ever paid, nothing to refund or withhold.
  let depositNote = null
  if (booking.depositStatus === 'paid' && booking.stripePaymentIntentId) {
    if (hoursUntilAppointment(booking.date, booking.startTime) >= 24) {
      try {
        await stripe.refunds.create({ payment_intent: booking.stripePaymentIntentId })
        await bookingRef.update({ depositStatus: 'refunded' })
        depositNote = 'refunded'
      } catch (err) {
        console.error('Failed to refund deposit:', err)
        Sentry.captureException(err)
        // Left as 'paid' so it's visible on the dashboard that a refund is
        // still owed — staff can retry from Stripe's dashboard directly.
      }
    } else {
      // Kept per the cancellation policy, not a failure — the booking's
      // depositStatus stays 'paid' since nothing went wrong.
      depositNote = 'kept'
    }
  }

  let emailSent = false
  try {
    await sendCancellationEmail({
      to: booking.email,
      name: booking.name,
      reference: booking.reference,
      services: booking.services,
      date: booking.date,
      startTime: booking.startTime,
      endTime: booking.endTime,
      depositNote,
      depositAmountCents: booking.depositAmountCents,
    })
    emailSent = true
  } catch (err) {
    console.error('Failed to send cancellation email:', err)
    Sentry.captureException(err)
  }

  res.status(200).json({ ok: true, hadEvent, calendarDeleted, emailSent, depositNote })
}
