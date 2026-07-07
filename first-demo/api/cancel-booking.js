import { adminDb } from './lib/firebaseAdmin.js'
import { deleteCalendarEvent } from './lib/googleCalendar.js'
import { sendCancellationEmail } from './lib/sendEmail.js'

// Verifies a Firebase Auth ID token via Google's public REST endpoint,
// avoiding firebase-admin/auth (whose JWKS-verification dependency chain
// isn't loadable in this Vercel runtime — see ERR_REQUIRE_ESM from jose).
async function verifyStaffToken(idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.VITE_FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  )
  if (!res.ok) return false
  const data = await res.json()
  return Boolean(data.users?.[0])
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
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
  }

  res.status(200).json({ ok: true, hadEvent, calendarDeleted, emailSent })
}
