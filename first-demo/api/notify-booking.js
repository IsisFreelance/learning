import Sentry from './_lib/sentry.js'
import { sendBookingEmail } from './_lib/sendEmail.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { generateConfirmToken } from './_lib/tokens.js'
import { buildCalendarLink } from './_lib/calendarLink.js'
import { createCalendarEvent } from './_lib/googleCalendar.js'

function hoursUntilAppointment(date, startTime) {
  const appointmentStart = new Date(`${date}T${startTime}:00`)
  return (appointmentStart.getTime() - Date.now()) / (1000 * 60 * 60)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const booking = req.body
  const calendarLink = buildCalendarLink(booking)

  // Creating the practice's calendar event is independent from sending the
  // email — one failing must never block the other.
  try {
    const eventId = await createCalendarEvent(booking)
    await adminDb.collection('bookings').doc(booking.bookingId).update({
      googleCalendarEventId: eventId,
    })
  } catch (err) {
    console.error('Failed to create Google Calendar event:', err)
    Sentry.captureException(err)
  }

  try {
    const hoursAway = hoursUntilAppointment(booking.date, booking.startTime)

    if (hoursAway < 24) {
      // Short-notice booking — send one combined email now, and mark it so the
      // daily reminder job doesn't send a second one for this booking later.
      const token = generateConfirmToken()
      await adminDb.collection('bookings').doc(booking.bookingId).update({
        confirmToken: token,
        reminderSent: true,
      })

      const proto = req.headers['x-forwarded-proto'] || 'https'
      const confirmLink = `${proto}://${req.headers.host}/api/confirm-appointment?bookingId=${booking.bookingId}&token=${token}`

      await sendBookingEmail({ ...booking, confirmLink, calendarLink })
    } else {
      await sendBookingEmail({ ...booking, calendarLink })
    }
  } catch (err) {
    console.error('Failed to send confirmation email:', err)
    Sentry.captureException(err)
  }

  // Always respond success — a failed notification must never look like a failed booking.
  res.status(200).json({ ok: true })
}
