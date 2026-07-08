import { FieldValue } from 'firebase-admin/firestore'
import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { tokensMatch } from './_lib/tokens.js'
import { sendRescheduleEmail } from './_lib/sendEmail.js'
import { createCalendarEvent, deleteCalendarEvent } from './_lib/googleCalendar.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'
import {
  computeSlotKeys,
  getBusinessHours,
  hhmmToMinutes,
  isBookingPast,
  minBookableDateStr,
  minutesToHHMM,
  SLOT_INTERVAL_MINUTES,
} from '../src/lib/scheduling.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

class SlotConflictError extends Error {
  constructor() {
    super('That time is no longer available. Please choose a different time.')
    this.name = 'SlotConflictError'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await checkRateLimit(`reschedule:${getClientIp(req)}`, { maxRequests: 15, windowMinutes: 5 })
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message })
      return
    }
    console.error('Rate limit check failed:', err)
    Sentry.captureException(err)
  }

  const { bookingId, token, newDate, newStartMinutes } = req.body

  // Every field is re-checked here — a well-formed-looking request is not
  // the same thing as a legitimate one (see api/notify-booking.js's fix).
  if (
    typeof bookingId !== 'string' ||
    !bookingId ||
    typeof token !== 'string' ||
    !token ||
    typeof newDate !== 'string' ||
    !DATE_PATTERN.test(newDate) ||
    typeof newStartMinutes !== 'number' ||
    !Number.isInteger(newStartMinutes) ||
    newStartMinutes < 0 ||
    newStartMinutes % SLOT_INTERVAL_MINUTES !== 0
  ) {
    res.status(400).json({ error: 'Invalid request' })
    return
  }

  const bookingRef = adminDb.collection('bookings').doc(bookingId)
  const snap = await bookingRef.get()

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

  const hours = getBusinessHours(newDate)
  if (
    newDate < minBookableDateStr() ||
    !hours ||
    newStartMinutes < hours.open ||
    newStartMinutes + booking.totalMinutes > hours.close
  ) {
    res.status(400).json({ error: "That time isn't available. Please choose a different time." })
    return
  }

  const oldSlotKeys = computeSlotKeys(booking.date, hhmmToMinutes(booking.startTime), booking.totalMinutes)
  const newSlotKeys = computeSlotKeys(newDate, newStartMinutes, booking.totalMinutes)
  const newStartTime = minutesToHHMM(newStartMinutes)
  const newEndTime = minutesToHHMM(newStartMinutes + booking.totalMinutes)

  try {
    await adminDb.runTransaction(async (transaction) => {
      // All reads before any writes, same discipline as the client-side
      // transaction in src/lib/bookings.js's createBooking().
      for (const key of newSlotKeys) {
        const slotSnap = await transaction.get(adminDb.collection('bookingSlots').doc(key))
        if (slotSnap.exists && slotSnap.data().bookingId !== bookingId) {
          throw new SlotConflictError()
        }
      }

      for (const key of oldSlotKeys) {
        transaction.delete(adminDb.collection('bookingSlots').doc(key))
      }
      for (const key of newSlotKeys) {
        const [slotDate, slotTime] = key.split('_')
        transaction.set(adminDb.collection('bookingSlots').doc(key), {
          date: slotDate,
          time: slotTime,
          bookingId,
        })
      }

      transaction.update(bookingRef, {
        date: newDate,
        startTime: newStartTime,
        endTime: newEndTime,
        status: 'Pending',
        // A move (whether the patient accepted a staff proposal or picked
        // their own time) always clears any pending proposal — it can
        // never linger stale once the booking has actually moved.
        proposedDate: FieldValue.delete(),
        proposedStartTime: FieldValue.delete(),
        proposedEndTime: FieldValue.delete(),
      })
    })
  } catch (err) {
    if (err instanceof SlotConflictError) {
      res.status(409).json({ error: err.message })
      return
    }
    console.error('Reschedule transaction failed:', err)
    Sentry.captureException(err)
    res.status(500).json({ error: 'Something went wrong rescheduling your appointment.' })
    return
  }

  // Calendar event and email are best-effort — the reschedule itself already
  // succeeded, so a failure here must not be reported as a failed request.
  try {
    if (booking.googleCalendarEventId) {
      await deleteCalendarEvent(booking.googleCalendarEventId)
    }
    const eventId = await createCalendarEvent({ ...booking, date: newDate, startTime: newStartTime, endTime: newEndTime })
    await bookingRef.update({ googleCalendarEventId: eventId })
  } catch (err) {
    console.error('Failed to update Google Calendar event after reschedule:', err)
    Sentry.captureException(err)
  }

  try {
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const manageLink = `${proto}://${req.headers.host}/manage-booking?bookingId=${bookingId}&token=${booking.manageToken}`
    await sendRescheduleEmail({
      to: booking.email,
      name: booking.name,
      reference: booking.reference,
      services: booking.services,
      oldDate: booking.date,
      oldStartTime: booking.startTime,
      oldEndTime: booking.endTime,
      date: newDate,
      startTime: newStartTime,
      endTime: newEndTime,
      manageLink,
    })
  } catch (err) {
    console.error('Failed to send reschedule email:', err)
    Sentry.captureException(err)
  }

  res.status(200).json({ ok: true, date: newDate, startTime: newStartTime, endTime: newEndTime })
}
