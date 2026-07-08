import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { deleteCalendarEvent } from './_lib/googleCalendar.js'
import { sendCancellationEmail } from './_lib/sendEmail.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'
import { verifyStaffToken } from './_lib/staffAuth.js'

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
    })
    emailSent = true
  } catch (err) {
    console.error('Failed to send cancellation email:', err)
    Sentry.captureException(err)
  }

  res.status(200).json({ ok: true, hadEvent, calendarDeleted, emailSent })
}
