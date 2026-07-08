// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookingModal from './BookingModal'

// The real ../lib/bookings imports firebaseClient.js unconditionally, which
// would otherwise try to initialize real Firebase App Check under jsdom.
vi.mock('../firebaseClient', () => ({ app: {}, db: {} }))

vi.mock('../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createBooking: vi.fn(),
    listenToTakenSlotTimes: vi.fn((date, onChange) => {
      onChange([])
      return () => {}
    }),
  }
})

vi.mock('@hcaptcha/react-hcaptcha', () => ({
  default: ({ onVerify }) => (
    <button type="button" onClick={() => onVerify('mock-captcha-token')}>
      Complete captcha
    </button>
  ),
}))

import { createBooking, SlotTakenError } from '../lib/bookings'

// Always a future Monday, so business-hours/date-in-the-future validation
// passes no matter what day the test suite happens to run on.
function nextMonday() {
  const d = new Date()
  const diff = ((8 - d.getDay()) % 7) || 7
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

async function fillValidForm(user) {
  await user.click(screen.getByLabelText(/Cleanings/))
  // jsdom's date input needs its value set directly — userEvent.type()
  // simulates per-character keystrokes, which real date inputs handle via
  // a native segment-editing widget that jsdom doesn't emulate.
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: nextMonday() } })
  await user.selectOptions(await screen.findByLabelText('Start time'), '480')
  await user.type(screen.getByLabelText('Name'), 'Jane Doe')
  await user.type(screen.getByLabelText('Email'), 'jane@example.com')
  await user.type(screen.getByLabelText('Phone'), '555-0100')
  await user.click(screen.getByText('Complete captcha'))
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn((url) => {
    if (url === '/api/verify-captcha') {
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) })
    }
    return Promise.resolve({ json: () => Promise.resolve({}) })
  })
})

describe('BookingModal', () => {
  it('shows the running total appointment time when a service is selected', async () => {
    const user = userEvent.setup()
    render(<BookingModal onClose={() => {}} />)

    await user.click(screen.getByLabelText(/Cleanings/))

    expect(screen.getByText('Total appointment time: 30 min')).toBeInTheDocument()
  })

  it('shows validation errors when submitting an empty form', async () => {
    const user = userEvent.setup()
    render(<BookingModal onClose={() => {}} />)

    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    expect(await screen.findByText('Choose at least one service.')).toBeInTheDocument()
    expect(screen.getByText('Choose a date.')).toBeInTheDocument()
    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText('Enter your email.')).toBeInTheDocument()
    expect(screen.getByText('Enter your phone number.')).toBeInTheDocument()
    expect(screen.getByText('Please complete the captcha.')).toBeInTheDocument()
    expect(createBooking).not.toHaveBeenCalled()
  })

  it('shows a confirmation with the reference number after a successful booking', async () => {
    createBooking.mockResolvedValue({ reference: 'BHD-000042', bookingId: 'abc123' })
    const user = userEvent.setup()
    render(<BookingModal onClose={() => {}} />)

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    expect(await screen.findByText('BHD-000042')).toBeInTheDocument()
    expect(screen.getByText("You're booked!")).toBeInTheDocument()
  })

  it('shows a friendly message when the slot was just taken by someone else', async () => {
    createBooking.mockRejectedValue(new SlotTakenError())
    const user = userEvent.setup()
    render(<BookingModal onClose={() => {}} />)

    await fillValidForm(user)
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    expect(
      await screen.findByText('That time is no longer available. Please choose a different time.')
    ).toBeInTheDocument()
  })
})
