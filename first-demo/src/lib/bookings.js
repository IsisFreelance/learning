import {
  collection,
  doc,
  getDocs,
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

const SLOT_INTERVAL_MINUTES = 15

export function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60).toString().padStart(2, '0')
  const m = (mins % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

export function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function formatTime12h(minutes) {
  const h24 = Math.floor(minutes / 60)
  const m = minutes % 60
  const period = h24 >= 12 ? 'PM' : 'AM'
  let h12 = h24 % 12
  if (h12 === 0) h12 = 12
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`
}

// Business hours, in minutes from midnight. Returns null when closed (Sundays).
export function getBusinessHours(dateStr) {
  const day = new Date(`${dateStr}T00:00:00`).getDay() // 0 = Sunday, 6 = Saturday
  if (day === 0) return null
  if (day === 6) return { open: 9 * 60, close: 14 * 60 } // Sat 9am-2pm
  return { open: 8 * 60, close: 18 * 60 } // Mon-Fri 8am-6pm
}

export function computeSlotKeys(dateStr, startMinutes, totalMinutes) {
  const keys = []
  for (let m = startMinutes; m < startMinutes + totalMinutes; m += SLOT_INTERVAL_MINUTES) {
    keys.push(`${dateStr}_${minutesToHHMM(m)}`)
  }
  return keys
}

export async function fetchTakenSlotTimes(dateStr) {
  const q = query(collection(db, 'bookingSlots'), where('date', '==', dateStr))
  const snap = await getDocs(q)
  return snap.docs.map((d) => d.data().time)
}

// Given already-taken slot times for the date, returns available start times (in minutes).
export function computeAvailableStartTimes(dateStr, totalMinutes, takenSlotTimes) {
  const hours = getBusinessHours(dateStr)
  if (!hours || totalMinutes <= 0) return []

  const taken = new Set(takenSlotTimes)
  const options = []

  for (let start = hours.open; start + totalMinutes <= hours.close; start += SLOT_INTERVAL_MINUTES) {
    let free = true
    for (let m = start; m < start + totalMinutes; m += SLOT_INTERVAL_MINUTES) {
      if (taken.has(minutesToHHMM(m))) {
        free = false
        break
      }
    }
    if (free) options.push(start)
  }

  return options
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

// True once the appointment's end time has already passed.
export function isBookingPast(booking) {
  return new Date(`${booking.date}T${booking.endTime}`) < new Date()
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
