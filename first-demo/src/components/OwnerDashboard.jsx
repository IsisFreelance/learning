import { useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import * as Sentry from '@sentry/react'
import { auth } from '../firebaseAuthClient'
import {
  computeAvailableStartTimes,
  deleteBooking,
  formatTime12h,
  getBusinessHours,
  groupBookingsByDate,
  hhmmToMinutes,
  isBookingPast,
  listenToBookings,
  listenToTakenSlotTimes,
  updateBookingStatus,
} from '../lib/bookings'
import DateField from './DateField'

function formatDayHeading(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// Bookings created before deposits existed have no depositStatus at all —
// shown as nothing rather than a misleading "Unpaid".
function depositLabel(booking) {
  if (!booking.depositStatus) return null
  const amount =
    typeof booking.depositAmountCents === 'number' ? ` ($${(booking.depositAmountCents / 100).toFixed(2)})` : ''
  switch (booking.depositStatus) {
    case 'paid':
      return `Deposit: Paid${amount}`
    case 'refunded':
      return `Deposit: Refunded${amount}`
    case 'pending_payment':
      return 'Deposit: Awaiting payment'
    default:
      return 'Deposit: Unpaid'
  }
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
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [updatingId, setUpdatingId] = useState(null)

  const [proposingId, setProposingId] = useState(null)
  const [proposeDate, setProposeDate] = useState('')
  const [proposeStartMinutes, setProposeStartMinutes] = useState('')
  const [proposeTakenSlotTimes, setProposeTakenSlotTimes] = useState([])
  const [proposeLoadingSlots, setProposeLoadingSlots] = useState(false)
  const [proposeSlotsError, setProposeSlotsError] = useState('')
  const [proposeSubmitting, setProposeSubmitting] = useState(false)
  const [proposeError, setProposeError] = useState('')

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setAuthLoaded(true)
      if (!u) {
        setUser(null)
        return
      }
      // Being logged in isn't enough — only accounts with the "staff"
      // custom claim (see scripts/set-staff-claim.js) get the dashboard.
      const tokenResult = await u.getIdTokenResult()
      if (tokenResult.claims.staff !== true) {
        setLoginError('This account is not authorized for staff access.')
        setUser(null)
        await signOut(auth)
        return
      }
      setUser(u)
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
    setLoadError('')
    const unsubscribe = listenToBookings(
      (fresh) => {
        setBookings(fresh)
        setLoadingBookings(false)
      },
      () => {
        setLoadError("Couldn't load bookings — please refresh the page.")
        setLoadingBookings(false)
      }
    )
    return unsubscribe
  }, [user])

  useEffect(() => {
    if (!proposeDate) return
    setProposeLoadingSlots(true)
    setProposeSlotsError('')
    setProposeStartMinutes('')
    const unsubscribe = listenToTakenSlotTimes(
      proposeDate,
      (times) => {
        setProposeTakenSlotTimes(times)
        setProposeLoadingSlots(false)
      },
      () => {
        setProposeSlotsError("Couldn't check availability — please try again.")
        setProposeLoadingSlots(false)
      }
    )
    return unsubscribe
  }, [proposeDate])

  function togglePropose(bookingId) {
    setProposingId((prev) => (prev === bookingId ? null : bookingId))
    setProposeDate('')
    setProposeStartMinutes('')
    setProposeError('')
  }

  async function submitPropose(bookingId) {
    if (!proposeDate || proposeStartMinutes === '') return

    setProposeSubmitting(true)
    setProposeError('')
    try {
      const idToken = await auth.currentUser.getIdToken()
      const res = await fetch('/api/propose-reschedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ bookingId, newDate: proposeDate, newStartMinutes: Number(proposeStartMinutes) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setProposeError(data.error || 'Could not propose that time. Please try again.')
        return
      }
      togglePropose(bookingId)
    } catch (err) {
      console.error('Error proposing reschedule:', err)
      Sentry.captureException(err)
      setProposeError('Could not propose that time. Please try again.')
    } finally {
      setProposeSubmitting(false)
    }
  }

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
      Sentry.captureException(err)
      setActionError('Could not delete that booking. Please try again.')
    }
    setUpdatingId(null)
  }

  const proposingBooking = bookings.find((b) => b.id === proposingId)
  const proposeBusinessHours = proposeDate ? getBusinessHours(proposeDate) : null
  const proposeAvailableStartTimes =
    proposeDate && proposingBooking && proposeBusinessHours
      ? computeAvailableStartTimes(proposeDate, proposingBooking.totalMinutes, proposeTakenSlotTimes)
      : []

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
      {loadError && <p className="form-error">{loadError}</p>}

      {loadingBookings ? (
        <p>Loading bookings…</p>
      ) : loadError ? null : bookings.length === 0 ? (
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
                    {depositLabel(b) && <p className="booking-contact">{depositLabel(b)}</p>}
                    {b.proposedDate && (
                      <p className="field-error">
                        Reschedule proposed: {b.proposedDate} &middot; {formatTime12h(hhmmToMinutes(b.proposedStartTime))} –{' '}
                        {formatTime12h(hhmmToMinutes(b.proposedEndTime))} — awaiting patient response
                      </p>
                    )}
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
                      <button
                        className="btn-cancel"
                        disabled={status === 'Cancelled' || isBookingPast(b) || updatingId === b.id}
                        onClick={() => togglePropose(b.id)}
                      >
                        {proposingId === b.id ? 'Close' : 'Propose reschedule'}
                      </button>
                    </div>

                    {proposingId === b.id && (
                      <div className="form-field">
                        <DateField value={proposeDate} onChange={setProposeDate} />

                        {proposeDate && proposeBusinessHours && (
                          <label className="form-field">
                            Start time
                            {proposeLoadingSlots ? (
                              <p>Checking availability…</p>
                            ) : proposeSlotsError ? (
                              <p className="field-error">{proposeSlotsError}</p>
                            ) : (
                              <select value={proposeStartMinutes} onChange={(e) => setProposeStartMinutes(e.target.value)}>
                                <option value="">Choose a time</option>
                                {proposeAvailableStartTimes.map((m) => (
                                  <option key={m} value={m}>
                                    {formatTime12h(m)}
                                  </option>
                                ))}
                              </select>
                            )}
                            {!proposeLoadingSlots && !proposeSlotsError && proposeAvailableStartTimes.length === 0 && (
                              <p className="field-error">No times available that day — try another date.</p>
                            )}
                          </label>
                        )}
                        {proposeDate && !proposeBusinessHours && (
                          <p className="field-error">We're closed Sundays — please pick another date.</p>
                        )}

                        {proposeError && <p className="form-error">{proposeError}</p>}

                        <button
                          className="btn-primary"
                          type="button"
                          disabled={proposeSubmitting || !proposeDate || proposeStartMinutes === ''}
                          onClick={() => submitPropose(b.id)}
                        >
                          {proposeSubmitting ? 'Sending…' : 'Send proposal'}
                        </button>
                      </div>
                    )}
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
