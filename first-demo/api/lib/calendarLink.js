export const PRACTICE_TIMEZONE = 'America/Los_Angeles'
export const PRACTICE_ADDRESS = '123 Harbor View Lane, Bright Harbor, CA 94123'
export const PRACTICE_PHONE = '(555) 012-3456'
export const PRACTICE_CONTACT_EMAIL = 'hello@brightharbordental.com'

// Turns "YYYY-MM-DD" + "HH:MM" into "YYYYMMDDTHHMMSS", the naive local
// (no timezone suffix) format Google Calendar expects alongside a ctz param.
function toCalendarDateTime(date, time) {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`
}

// Builds a link that opens Google Calendar with the appointment pre-filled —
// no login or API call involved, safe to put in any email.
export function buildCalendarLink({ services, date, startTime, endTime }) {
  const serviceList = Array.isArray(services) ? services.join(', ') : services

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Bright Harbor Dental — ${serviceList}`,
    dates: `${toCalendarDateTime(date, startTime)}/${toCalendarDateTime(date, endTime)}`,
    details: `Appointment for ${serviceList} at Bright Harbor Dental.`,
    location: PRACTICE_ADDRESS,
    ctz: PRACTICE_TIMEZONE,
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
