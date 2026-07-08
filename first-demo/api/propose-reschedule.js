import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { verifyStaffToken } from './_lib/staffAuth.js'
import { sendReschedProposalEmail } from './_lib/sendEmail.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'
import {
  computeSlotKeys,
  getBusinessHours,
  isBookingPast,
  minBookableDateStr,
  minutesToHHMM,
  SLOT_INTERVAL_MINUTES,
} from '../src/lib/scheduling.js'

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await checkRateLimit(`propose-reschedule:${getClientIp(req)}`, { maxRequests: 15, windowMinutes: 5 })
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

  const { bookingId, newDate, newStartMinutes } = req.body

  // Same discipline as api/reschedule-booking.js — a well-formed-looking
  // request from an authenticated staff member is still fully re-validated.
  if (
    typeof bookingId !== 'string' ||
    !bookingId ||
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
  if (!snap.exists) {
    res.status(404).json({ error: 'Booking not found' })
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

  // Read-only check — nothing is being claimed yet, this is just a
  // proposal, so no transaction is needed, only a heads-up that the slots
  // aren't already held by some other booking.
  const newSlotKeys = computeSlotKeys(newDate, newStartMinutes, booking.totalMinutes)
  for (const key of newSlotKeys) {
    const slotSnap = await adminDb.collection('bookingSlots').doc(key).get()
    if (slotSnap.exists && slotSnap.data().bookingId !== bookingId) {
      res.status(409).json({ error: 'That time is already taken. Please choose a different time.' })
      return
    }
  }

  const proposedStartTime = minutesToHHMM(newStartMinutes)
  const proposedEndTime = minutesToHHMM(newStartMinutes + booking.totalMinutes)

  await bookingRef.update({
    proposedDate: newDate,
    proposedStartTime,
    proposedEndTime,
  })

  try {
    const proto = req.headers['x-forwarded-proto'] || 'https'
    const manageLink = `${proto}://${req.headers.host}/manage-booking?bookingId=${bookingId}&token=${booking.manageToken}`
    await sendReschedProposalEmail({
      to: booking.email,
      name: booking.name,
      reference: booking.reference,
      services: booking.services,
      proposedDate: newDate,
      proposedStartTime,
      proposedEndTime,
      manageLink,
    })
  } catch (err) {
    console.error('Failed to send reschedule proposal email:', err)
    Sentry.captureException(err)
  }

  res.status(200).json({ ok: true, proposedDate: newDate, proposedStartTime, proposedEndTime })
}
