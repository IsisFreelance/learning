import { FieldValue } from 'firebase-admin/firestore'
import Sentry from './sentry.js'
import { sendBookingEmail } from './sendEmail.js'
import { generateConfirmToken } from './tokens.js'
import { buildCalendarLink } from './calendarLink.js'
import { createCalendarEvent } from './googleCalendar.js'
import { hoursUntilAppointment } from '../../src/lib/scheduling.js'

// Sends the confirmation email and creates the practice's Google Calendar
// event for a booking that's now real and ready to notify about — called
// from api/stripe-webhook.js (the primary trigger, once a deposit is paid)
// and api/notify-booking.js (kept as a manual resend/retry tool). Both
// callers already guarantee `booking.notifiedAt` is unset before calling
// this, so it doesn't re-check that itself.
export async function finalizeBooking(bookingRef, booking, bookingId) {
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
}
