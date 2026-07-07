import { describe, it, expect } from 'vitest'
import { buildCalendarLink, PRACTICE_TIMEZONE, PRACTICE_ADDRESS } from './calendarLink.js'

describe('buildCalendarLink', () => {
  const link = buildCalendarLink({
    services: ['Cleanings', 'Whitening'],
    date: '2026-07-07',
    startTime: '15:30',
    endTime: '16:00',
  })

  it('points at the Google Calendar render endpoint', () => {
    expect(link.startsWith('https://calendar.google.com/calendar/render?')).toBe(true)
  })

  it('encodes the naive local start/end times with no timezone suffix', () => {
    expect(link).toContain('dates=20260707T153000%2F20260707T160000')
  })

  it('includes the service list, practice address, and timezone', () => {
    // URLSearchParams encodes spaces as "+" (form-encoding), not "%20" like encodeURIComponent.
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('text')).toContain('Cleanings, Whitening')
    expect(params.get('location')).toBe(PRACTICE_ADDRESS)
    expect(params.get('ctz')).toBe(PRACTICE_TIMEZONE)
  })
})
