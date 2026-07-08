import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { generateConfirmToken, tokensMatch } from './_lib/tokens.js'
import { sendBookingEmail } from './_lib/sendEmail.js'
import { buildCalendarLink } from './_lib/calendarLink.js'

function tomorrowDateStr() {
  const now = new Date()
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return tomorrow.toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || ''
  const providedSecret = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  if (!providedSecret || !tokensMatch(providedSecret, process.env.CRON_SECRET)) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const dateStr = tomorrowDateStr()
  const snap = await adminDb.collection('bookings').where('date', '==', dateStr).get()

  const baseUrl = process.env.PUBLIC_BASE_URL

  let sent = 0
  for (const doc of snap.docs) {
    const booking = doc.data()
    if (booking.reminderSent) continue

    const token = generateConfirmToken()
    await doc.ref.update({ confirmToken: token, reminderSent: true })

    const confirmLink = `${baseUrl}/api/confirm-appointment?bookingId=${doc.id}&token=${token}`

    try {
      await sendBookingEmail({
        to: booking.email,
        name: booking.name,
        reference: booking.reference,
        services: booking.services,
        date: booking.date,
        startTime: booking.startTime,
        endTime: booking.endTime,
        confirmLink,
        calendarLink: buildCalendarLink(booking),
        subject: `Reminder: Your appointment tomorrow (${booking.reference})`,
      })
      sent += 1
    } catch (err) {
      console.error(`Failed to send reminder for booking ${doc.id}:`, err)
      Sentry.captureException(err)
    }
  }

  res.status(200).json({ ok: true, date: dateStr, remindersSent: sent })
}
