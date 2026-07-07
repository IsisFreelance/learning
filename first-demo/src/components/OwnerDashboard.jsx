import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../firebaseAuthClient'
import {
  deleteBooking,
  formatTime12h,
  groupBookingsByDate,
  hhmmToMinutes,
  isBookingPast,
  listenToBookings,
  updateBookingStatus,
} from '../lib/bookings'

function formatDayHeading(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function friendlyAuthError(code) {
  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  ) {
    return 'Incorrect email or password.'
  }
  return 'Something went wrong logging in. Please try again.'
}

function OwnerDashboard() {
  const [authLoaded, setAuthLoaded] = useState(false)
  const [user, setUser] = useState(null)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  const [bookings, setBookings] = useState([])
  const [loadingBookings, setLoadingBookings] = useState(false)
  const [actionError, setActionError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setAuthLoaded(true)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user) {
      setBookings([])
      setEmail('')
      setPassword('')
      return
    }
    setLoadingBookings(true)
    const unsubscribe = listenToBookings((fresh) => {
      setBookings(fresh)
      setLoadingBookings(false)
    })
    return unsubscribe
  }, [user])

  async function handleLogin(e) {
    e.preventDefault()
    setLoginError('')
    setLoggingIn(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err) {
      setLoginError(friendlyAuthError(err.code))
    } finally {
      setLoggingIn(false)
    }
  }

  async function handleStatusChange(bookingId, status) {
    setActionError('')
    setUpdatingId(bookingId)
    try {
      await updateBookingStatus(bookingId, status)
      setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status } : b)))
    } catch {
      setActionError('Could not update that booking. Please try again.')
      setUpdatingId(null)
      return
    }

    if (status === 'Cancelled') {
      try {
        const idToken = await auth.currentUser.getIdToken()
        const res = await fetch('/api/cancel-booking', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ bookingId }),
        })
        const data = await res.json()
        if (data.hadEvent && !data.calendarDeleted) {
          setActionError('Booking cancelled, but the calendar event may need to be removed manually.')
        } else if (!data.emailSent) {
          setActionError('Booking cancelled, but the patient notification email may not have sent.')
        }
      } catch {
        setActionError('Booking cancelled, but the calendar event/email notification may need to be handled manually.')
      }
    }

    setUpdatingId(null)
  }

  async function handleDelete(booking) {
    if (!window.confirm('Permanently delete this booking? This cannot be undone.')) return

    setActionError('')
    setUpdatingId(booking.id)
    try {
      await deleteBooking(booking)
    } catch (err) {
      console.error('Failed to delete booking:', err)
      setActionError('Could not delete that booking. Please try again.')
    }
    setUpdatingId(null)
  }

  if (!authLoaded) return null

  if (!user) {
    return (
      <main className="owner-page">
        <section className="section auth-form">
          <h2>Staff Login</h2>
          <form onSubmit={handleLogin}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              required
            />
            {loginError && <p className="auth-error">{loginError}</p>}
            <button type="submit" disabled={loggingIn}>
              {loggingIn ? 'Logging in…' : 'Log in'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="owner-page">
      <div className="owner-header">
        <h2>Bookings</h2>
        <button className="signout-link" onClick={() => signOut(auth)}>
          Log out
        </button>
      </div>

      {actionError && <p className="form-error">{actionError}</p>}

      {loadingBookings ? (
        <p>Loading bookings…</p>
      ) : bookings.length === 0 ? (
        <p>No bookings yet.</p>
      ) : (
        groupBookingsByDate(bookings).map((group) => (
          <section key={group.date} className="booking-day-group">
            <h3 className="booking-day-heading">{formatDayHeading(group.date)}</h3>
            <div className="booking-list">
              {group.bookings.map((b) => {
                const status = b.status || 'Pending'
                const canDelete = status === 'Cancelled' || isBookingPast(b)
                return (
                  <article key={b.id} className="booking-row">
                    <div className="booking-card-top">
                      <span className="booking-reference">{b.reference}</span>
                      <span className={`booking-status status-${status.toLowerCase()}`}>{status}</span>
                    </div>
                    <p className="booking-patient">{b.name}</p>
                    <p className="booking-contact">
                      {b.email} &middot; {b.phone}
                    </p>
                    <p>{Array.isArray(b.services) ? b.services.join(', ') : b.services}</p>
                    <p>
                      {formatTime12h(hhmmToMinutes(b.startTime))} –{' '}
                      {formatTime12h(hhmmToMinutes(b.endTime))}
                    </p>
                    <div className="booking-actions">
                      <button
                        className="btn-confirm"
                        disabled={status === 'Confirmed' || updatingId === b.id}
                        onClick={() => handleStatusChange(b.id, 'Confirmed')}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn-cancel"
                        disabled={status === 'Cancelled' || updatingId === b.id}
                        onClick={() => handleStatusChange(b.id, 'Cancelled')}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn-delete"
                        disabled={!canDelete || updatingId === b.id}
                        onClick={() => handleDelete(b)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))
      )}
    </main>
  )
}

export default OwnerDashboard
