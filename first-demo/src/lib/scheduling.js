// Pure date/time/slot math — no Firebase, no DOM. Shared by the client
// (src/lib/bookings.js) and server-side API routes (e.g. api/reschedule-booking.js)
// via a plain relative import, so both sides compute availability identically
// instead of maintaining two copies that could drift out of sync.

export const SLOT_INTERVAL_MINUTES = 15

// Formats a Date using its LOCAL calendar components — deliberately not
// toISOString(), which always renders in UTC. Mixing local arithmetic
// (setDate/getDate) with UTC formatting produces a date that's off by one
// depending on timezone and time of day; keeping both steps in the same
// (local) frame of reference avoids that.
function formatLocalDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Bookings and reschedules both require at least a day's notice — the
// simplest way to guarantee a picked time can never already be in the
// past, without needing separate "is this exact moment already over"
// logic anywhere (today's date alone was never enough: business hours and
// taken-slot checks don't know what time it is right now).
export function minBookableDateStr() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return formatLocalDate(d)
}

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

// True once the appointment's end time has already passed.
export function isBookingPast(booking) {
  return new Date(`${booking.date}T${booking.endTime}`) < new Date()
}

// How many hours from right now until the appointment starts — used both
// for the "is this short-notice enough to send one combined confirm+reminder
// email" check (api/notify-booking.js) and the "is this cancellation early
// enough to refund the deposit" check (api/cancel-booking.js).
export function hoursUntilAppointment(date, startTime) {
  const appointmentStart = new Date(`${date}T${startTime}:00`)
  return (appointmentStart.getTime() - Date.now()) / (1000 * 60 * 60)
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
