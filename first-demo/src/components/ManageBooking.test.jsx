// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ManageBooking from './ManageBooking'

// The real ../lib/bookings imports firebaseClient.js unconditionally, which
// would otherwise try to initialize real Firebase App Check under jsdom.
vi.mock('../firebaseClient', () => ({ app: {}, db: {} }))

vi.mock('../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    listenToTakenSlotTimes: vi.fn((date, onChange) => {
      onChange([])
      return () => {}
    }),
  }
})

// Always a future Monday, so business-hours/date-in-the-future validation
// passes no matter what day the test suite happens to run on.
function nextMonday() {
  const d = new Date()
  const diff = ((8 - d.getDay()) % 7) || 7
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

const validBookingResponse = {
  reference: 'BHD-000042',
  services: ['Cleanings'],
  totalMinutes: 30,
  date: '2026-07-13',
  startTime: '08:00',
  endTime: '08:30',
  status: 'Pending',
  name: 'Jane Doe',
}

beforeEach(() => {
  window.history.pushState({}, '', '/manage-booking?bookingId=abc123&token=sometoken')
  global.fetch = vi.fn()
})

describe('ManageBooking', () => {
  it('shows an error when the link is missing bookingId/token', async () => {
    window.history.pushState({}, '', '/manage-booking')
    render(<ManageBooking />)

    expect(await screen.findByText('This link is missing information.')).toBeInTheDocument()
  })

  it('shows an error when the link is invalid or expired', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Link not found or expired' }),
    })

    render(<ManageBooking />)

    expect(await screen.findByText('Link not found or expired')).toBeInTheDocument()
  })

  it('shows the current booking and a date/time picker for a valid link', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(validBookingResponse),
    })

    render(<ManageBooking />)

    expect(await screen.findByText('BHD-000042', { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/Currently: 2026-07-13/)).toBeInTheDocument()
    expect(screen.getByLabelText('Date')).toBeInTheDocument()
  })

  it('reschedules to a new time and shows confirmation', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.startsWith('/api/manage-booking')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(validBookingResponse) })
      }
      if (url === '/api/reschedule-booking') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, date: nextMonday(), startTime: '09:00', endTime: '09:30' }),
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const user = userEvent.setup()
    render(<ManageBooking />)
    await screen.findByText('BHD-000042', { exact: false })

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: nextMonday() } })
    await user.selectOptions(await screen.findByLabelText('Start time'), '540')
    await user.click(screen.getByRole('button', { name: 'Confirm new time' }))

    expect(await screen.findByText("You're all set!")).toBeInTheDocument()
    expect(screen.getByText(/9:00 AM/)).toBeInTheDocument()
  })

  it('accepts a staff-proposed time with one click', async () => {
    const proposedBookingResponse = {
      ...validBookingResponse,
      proposedDate: '2026-07-20',
      proposedStartTime: '10:00',
      proposedEndTime: '10:30',
    }
    global.fetch.mockImplementation((url) => {
      if (url.startsWith('/api/manage-booking')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(proposedBookingResponse) })
      }
      if (url === '/api/reschedule-booking') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, date: '2026-07-20', startTime: '10:00', endTime: '10:30' }),
        })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })

    const user = userEvent.setup()
    render(<ManageBooking />)
    await screen.findByText('BHD-000042', { exact: false })

    expect(screen.getByText(/Proposed new time: 2026-07-20/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Accept this time' }))

    expect(await screen.findByText("You're all set!")).toBeInTheDocument()
    expect(screen.getByText(/10:00 AM/)).toBeInTheDocument()

    const rescheduleCall = global.fetch.mock.calls.find(([url]) => url === '/api/reschedule-booking')
    const body = JSON.parse(rescheduleCall[1].body)
    expect(body).toMatchObject({ newDate: '2026-07-20', newStartMinutes: 600 })
  })
})
