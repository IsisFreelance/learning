// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import OwnerDashboard from './OwnerDashboard'
import { listenToBookings, updateBookingStatus } from '../lib/bookings'

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}))

vi.mock('../firebaseAuthClient', () => ({ auth: {} }))

// The real ../lib/bookings imports firebaseClient.js unconditionally, which
// would otherwise try to initialize real Firebase App Check under jsdom.
vi.mock('../firebaseClient', () => ({ app: {}, db: {} }))

vi.mock('../lib/bookings', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    listenToBookings: vi.fn(() => () => {}),
    deleteBooking: vi.fn(),
    updateBookingStatus: vi.fn(),
  }
})

const staffUser = { getIdTokenResult: vi.fn().mockResolvedValue({ claims: { staff: true } }) }
const nonStaffUser = { getIdTokenResult: vi.fn().mockResolvedValue({ claims: {} }) }

const sampleBooking = {
  id: 'b1',
  reference: 'BHD-000001',
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '555-0100',
  services: ['Cleanings'],
  date: '2026-07-13',
  startTime: '08:00',
  endTime: '08:30',
  status: 'Pending',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('OwnerDashboard', () => {
  it('shows the staff login form when not logged in', async () => {
    onAuthStateChanged.mockImplementation((auth, cb) => {
      cb(null)
      return () => {}
    })

    render(<OwnerDashboard />)

    expect(await screen.findByText('Staff Login')).toBeInTheDocument()
  })

  it('rejects a logged-in user without the staff claim', async () => {
    onAuthStateChanged.mockImplementation((auth, cb) => {
      cb(nonStaffUser)
      return () => {}
    })

    render(<OwnerDashboard />)

    expect(
      await screen.findByText('This account is not authorized for staff access.')
    ).toBeInTheDocument()
    expect(signOut).toHaveBeenCalled()
  })

  it('shows bookings for an authorized staff user', async () => {
    listenToBookings.mockImplementation((onChange) => {
      onChange([sampleBooking])
      return () => {}
    })
    onAuthStateChanged.mockImplementation((auth, cb) => {
      cb(staffUser)
      return () => {}
    })

    render(<OwnerDashboard />)

    expect(await screen.findByText('BHD-000001')).toBeInTheDocument()
    expect(screen.getByText('Jane Doe')).toBeInTheDocument()
  })

  it('confirming a booking updates its status', async () => {
    listenToBookings.mockImplementation((onChange) => {
      onChange([sampleBooking])
      return () => {}
    })
    onAuthStateChanged.mockImplementation((auth, cb) => {
      cb(staffUser)
      return () => {}
    })
    updateBookingStatus.mockResolvedValue()

    const user = userEvent.setup()
    render(<OwnerDashboard />)
    await screen.findByText('BHD-000001')

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(updateBookingStatus).toHaveBeenCalledWith('b1', 'Confirmed')
    expect(await screen.findByText('Confirmed')).toBeInTheDocument()
  })
})
