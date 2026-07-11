// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import DateField from './DateField'

// Fixing "tomorrow" makes the disabled/enabled boundaries deterministic
// regardless of what day the test suite actually runs on. 2026-07-14 is a
// Tuesday; getBusinessHours (the real implementation) confirms 2026-07-05
// and 2026-07-12 are Sundays, per the existing fixture in bookings.test.js.
vi.mock('../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, minBookableDateStr: () => '2026-07-14' }
})

describe('DateField', () => {
  it('disables a closed day (Sunday) and does not fire onChange when clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<DateField value="" onChange={onChange} />)

    const sunday = container.querySelector('[data-date="2026-07-19"]')
    expect(sunday).toBeDisabled()

    fireEvent.click(sunday)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('fires onChange with the date string when a valid open day is clicked', () => {
    const onChange = vi.fn()
    const { container } = render(<DateField value="" onChange={onChange} />)

    const tuesday = container.querySelector('[data-date="2026-07-14"]')
    expect(tuesday).not.toBeDisabled()

    fireEvent.click(tuesday)
    expect(onChange).toHaveBeenCalledWith('2026-07-14')
  })

  it('disables an otherwise-open weekday that falls before the minimum bookable date', () => {
    const onChange = vi.fn()
    const { container } = render(<DateField value="" onChange={onChange} />)

    const monday = container.querySelector('[data-date="2026-07-13"]')
    expect(monday).toBeDisabled()

    fireEvent.click(monday)
    expect(onChange).not.toHaveBeenCalled()
  })
})
