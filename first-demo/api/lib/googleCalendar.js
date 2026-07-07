import { JWT } from 'google-auth-library'
import { PRACTICE_TIMEZONE } from './calendarLink.js'

const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3'

// Reuses the same Firebase Admin service account credentials already set up
// for Firestore — a Google service account isn't locked to one API, so the
// only new setup needed is sharing a calendar with it (see README/plan notes).
function getAuthClient() {
  return new JWT({
    email: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    key: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/calendar.events'],
  })
}

export async function createCalendarEvent({ services, date, startTime, endTime }) {
  const client = getAuthClient()
  const { access_token: accessToken } = await client.authorize()
  const serviceList = Array.isArray(services) ? services.join(', ') : services

  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: `Bright Harbor Dental — ${serviceList}`,
        description: `Appointment for ${serviceList}.`,
        start: { dateTime: `${date}T${startTime}:00`, timeZone: PRACTICE_TIMEZONE },
        end: { dateTime: `${date}T${endTime}:00`, timeZone: PRACTICE_TIMEZONE },
      }),
    }
  )

  if (!res.ok) {
    throw new Error(`Google Calendar create event failed: ${res.status} ${await res.text()}`)
  }

  const event = await res.json()
  return event.id
}

export async function deleteCalendarEvent(eventId) {
  const client = getAuthClient()
  const { access_token: accessToken } = await client.authorize()

  const res = await fetch(
    `${CALENDAR_API_BASE}/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID)}/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  )

  // 404/410 means the event is already gone — treat that as success too.
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google Calendar delete event failed: ${res.status} ${await res.text()}`)
  }
}
