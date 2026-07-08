import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebaseClient'
import { computeSlotKeys, hhmmToMinutes, minutesToHHMM } from './scheduling'

export {
  computeAvailableStartTimes,
  computeSlotKeys,
  formatTime12h,
  getBusinessHours,
  hhmmToMinutes,
  isBookingPast,
  minutesToHHMM,
} from './scheduling'

// A patient-facing secret for the "manage my booking" link (see
// ManageBooking.jsx / api/manage-booking.js) — generated the same way
// api/_lib/tokens.js does server-side (crypto.randomBytes), just with the
// browser's equivalent RNG, since this transaction runs client-side.
function randomToken() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

// Live availability for a given date — onChange fires immediately, then again
// whenever a slot for that date is taken or freed (by anyone, anywhere), so
// two people looking at the same day see it update without a page reload.
export function listenToTakenSlotTimes(dateStr, onChange) {
  const q = query(collection(db, 'bookingSlots'), where('date', '==', dateStr))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => d.data().time))
  })
}

// Thrown when the requested time is no longer available (lost a race to another booking).
export class SlotTakenError extends Error {
  constructor() {
    super('That time is no longer available. Please choose a different time.')
    this.name = 'SlotTakenError'
  }
}

export async function createBooking({ services, totalMinutes, date, startMinutes, name, email, phone }) {
  const slotKeys = computeSlotKeys(date, startMinutes, totalMinutes)
  const bookingRef = doc(collection(db, 'bookings'))
  const counterRef = doc(db, 'counters', 'bookings')
  const manageToken = randomToken()

  return runTransaction(db, async (transaction) => {
    // All reads must happen before any writes in a Firestore transaction.
    for (const key of slotKeys) {
      const slotSnap = await transaction.get(doc(db, 'bookingSlots', key))
      if (slotSnap.exists()) {
        throw new SlotTakenError()
      }
    }
    const counterSnap = await transaction.get(counterRef)
    const nextCount = (counterSnap.exists() ? counterSnap.data().count : 0) + 1
    const reference = `BHD-${String(nextCount).padStart(6, '0')}`

    for (const key of slotKeys) {
      const [slotDate, slotTime] = key.split('_')
      transaction.set(doc(db, 'bookingSlots', key), {
        date: slotDate,
        time: slotTime,
        bookingId: bookingRef.id,
      })
    }

    transaction.set(bookingRef, {
      services,
      totalMinutes,
      date,
      startTime: minutesToHHMM(startMinutes),
      endTime: minutesToHHMM(startMinutes + totalMinutes),
      name,
      email,
      phone,
      reference,
      status: 'Pending',
      manageToken,
      createdAt: serverTimestamp(),
    })
    transaction.set(counterRef, { count: nextCount })

    return { reference, bookingId: bookingRef.id }
  })
}

// Subscribes to live booking updates — onChange fires immediately with the
// current data, then again every time anything changes in Firestore (a
// patient confirming via email, a status change, etc). Returns an unsubscribe
// function, meant to be called from a React effect's cleanup.
export function listenToBookings(onChange) {
  // Ordered by the date+startTime composite index (see firestore.indexes.json) —
  // groupBookingsByDate re-sorts for display anyway, but this keeps the raw
  // data itself properly ordered rather than relying on a client-side sort.
  const q = query(collection(db, 'bookings'), orderBy('date', 'asc'), orderBy('startTime', 'asc'))
  return onSnapshot(q, (snap) => {
    const bookings = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    onChange(bookings)
  })
}

export async function updateBookingStatus(bookingId, status) {
  await updateDoc(doc(db, 'bookings', bookingId), { status })
}

// Permanently removes a booking and frees up its time slot(s).
export async function deleteBooking(booking) {
  const startMinutes = hhmmToMinutes(booking.startTime)
  const slotKeys = computeSlotKeys(booking.date, startMinutes, booking.totalMinutes)

  const batch = writeBatch(db)
  for (const key of slotKeys) {
    batch.delete(doc(db, 'bookingSlots', key))
  }
  batch.delete(doc(db, 'bookings', booking.id))
  await batch.commit()
}

// Buckets bookings by date (oldest date first), each day's bookings sorted by start time.
export function groupBookingsByDate(bookings) {
  const byDate = new Map()
  for (const booking of bookings) {
    if (!byDate.has(booking.date)) byDate.set(booking.date, [])
    byDate.get(booking.date).push(booking)
  }

  return Array.from(byDate.entries())
    .sort(([dateA], [dateB]) => dateA.localeCompare(dateB))
    .map(([date, dayBookings]) => ({
      date,
      bookings: [...dayBookings].sort((a, b) => a.startTime.localeCompare(b.startTime)),
    }))
}
