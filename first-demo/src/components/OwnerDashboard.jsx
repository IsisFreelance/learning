import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../firebaseClient'
import { fetchAllBookings, formatTime12h, hhmmToMinutes, updateBookingStatus } from '../lib/bookings'

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
    fetchAllBookings()
      .then(setBookings)
      .catch(() => setActionError('Could not load bookings. Please refresh and try again.'))
      .finally(() => setLoadingBookings(false))
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
    } finally {
      setUpdatingId(null)
    }
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
        <div className="booking-list">
          {bookings.map((b) => {
            const status = b.status || 'Pending'
            return (
              <article key={b.id} className="booking-card">
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
                  {b.date} &middot; {formatTime12h(hhmmToMinutes(b.startTime))} –{' '}
                  {formatTime12h(hhmmToMinutes(b.endTime))}
                </p>
                <p className="patient-confirmation">
                  {b.confirmedByPatient ? 'Patient confirmed ✓' : 'Awaiting patient confirmation'}
                </p>
                <div className="booking-actions">
                  <button
                    disabled={status === 'Confirmed' || updatingId === b.id}
                    onClick={() => handleStatusChange(b.id, 'Confirmed')}
                  >
                    Confirm
                  </button>
                  <button
                    disabled={status === 'Cancelled' || updatingId === b.id}
                    onClick={() => handleStatusChange(b.id, 'Cancelled')}
                  >
                    Cancel
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}

export default OwnerDashboard
