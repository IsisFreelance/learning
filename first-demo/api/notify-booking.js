import { FieldValue } from 'firebase-admin/firestore'
import Sentry from './_lib/sentry.js'
import { sendBookingEmail } from './_lib/sendEmail.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { generateConfirmToken } from './_lib/tokens.js'
import { buildCalendarLink } from './_lib/calendarLink.js'
import { createCalendarEvent } from './_lib/googleCalendar.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'

function hoursUntilAppointment(date, startTime) {
  const appointmentStart = new Date(`${date}T${startTime}:00`)
  return (appointmentStart.getTime() - Date.now()) / (1000 * 60 * 60)
}

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

  const calendarLink = buildCalendarLink(booking)
  const manageLink = `${process.env.PUBLIC_BASE_URL}/manage-booking?bookingId=${bookingId}&token=${booking.manageToken}`

  // Creating the practice's calendar event is independent from sending the
  // email — one failing must never block the other.
  if (!booking.googleCalendarEventId) {
    try {
      const eventId = await createCalendarEvent(booking)
      await bookingRef.update({ googleCalendarEventId: eventId })
    } catch (err) {
      console.error('Failed to create Google Calendar event:', err)
      Sentry.captureException(err)
    }
  }

  try {
    const hoursAway = hoursUntilAppointment(booking.date, booking.startTime)

    if (hoursAway < 24) {
      // Short-notice booking — send one combined email now, and mark it so the
      // daily reminder job doesn't send a second one for this booking later.
      const token = generateConfirmToken()
      await bookingRef.update({ confirmToken: token, reminderSent: true })

      const confirmLink = `${process.env.PUBLIC_BASE_URL}/api/confirm-appointment?bookingId=${bookingId}&token=${token}`

      await sendBookingEmail({ ...booking, to: booking.email, confirmLink, calendarLink, manageLink })
    } else {
      await sendBookingEmail({ ...booking, to: booking.email, calendarLink, manageLink })
    }
    // Only marked once the email actually went out — a send failure below
    // must leave notifiedAt unset so a retry can still succeed, instead of
    // permanently no-oping on a booking that was never actually emailed.
    await bookingRef.update({ notifiedAt: FieldValue.serverTimestamp() })
  } catch (err) {
    console.error('Failed to send confirmation email:', err)
    Sentry.captureException(err)
  }

  // Always respond success — a failed notification must never look like a failed booking.
  res.status(200).json({ ok: true })
}
