import { describe, it, expect } from 'vitest'
import { computeAvailableStartTimes, groupBookingsByDate, isBookingPast } from './bookings'

describe('computeAvailableStartTimes', () => {
  it('returns no times on a Sunday (closed)', () => {
    // 2026-07-05 is a Sunday
    expect(computeAvailableStartTimes('2026-07-05', 30, [])).toEqual([])
  })

  it('returns times starting at business open with no taken slots', () => {
    // 2026-07-06 is a Monday, opens at 8:00am (480 minutes)
    const times = computeAvailableStartTimes('2026-07-06', 30, [])
    expect(times[0]).toBe(480)
    expect(times.length).toBeGreaterThan(0)
  })

  it('excludes start times that overlap a taken slot', () => {
    const times = computeAvailableStartTimes('2026-07-06', 30, ['08:00', '08:15'])
    expect(times).not.toContain(480) // 8:00 overlaps 08:00
    expect(times).not.toContain(465) // 7:45 would overlap 08:00 too, but that's before opening anyway
    expect(times).toContain(510) // 8:30 is free
  })

  it('returns no times when duration is zero or negative', () => {
    expect(computeAvailableStartTimes('2026-07-06', 0, [])).toEqual([])
  })
})

describe('groupBookingsByDate', () => {
  it('groups bookings by date, sorted ascending, days and times both ordered', () => {
    const bookings = [
      { id: '1', date: '2026-07-08', startTime: '10:00' },
      { id: '2', date: '2026-07-07', startTime: '15:00' },
      { id: '3', date: '2026-07-07', startTime: '09:00' },
    ]

    const groups = groupBookingsByDate(bookings)

    expect(groups.map((g) => g.date)).toEqual(['2026-07-07', '2026-07-08'])
    expect(groups[0].bookings.map((b) => b.id)).toEqual(['3', '2'])
    expect(groups[1].bookings.map((b) => b.id)).toEqual(['1'])
  })

  it('returns an empty array for no bookings', () => {
    expect(groupBookingsByDate([])).toEqual([])
  })
})

describe('isBookingPast', () => {
  it('returns true for a booking whose end time is in the past', () => {
    expect(isBookingPast({ date: '2000-01-01', endTime: '00:00' })).toBe(true)
  })

  it('returns false for a booking far in the future', () => {
    expect(isBookingPast({ date: '2999-01-01', endTime: '00:00' })).toBe(false)
  })
})
