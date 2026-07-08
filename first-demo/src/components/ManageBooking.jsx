import { useEffect, useState } from 'react'
import * as Sentry from '@sentry/react'
import {
  computeAvailableStartTimes,
  formatTime12h,
  getBusinessHours,
  hhmmToMinutes,
  listenToTakenSlotTimes,
} from '../lib/bookings'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function getLinkParams() {
  const params = new URLSearchParams(window.location.search)
  return { bookingId: params.get('bookingId'), token: params.get('token') }
}

function ManageBooking() {
  const [bookingId] = useState(() => getLinkParams().bookingId)
  const [token] = useState(() => getLinkParams().token)

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [booking, setBooking] = useState(null)

  const [date, setDate] = useState('')
  const [startMinutes, setStartMinutes] = useState('')
  const [takenSlotTimes, setTakenSlotTimes] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [result, setResult] = useState(null)

  useEffect(() => {
    if (!bookingId || !token) {
      setLoadError('This link is missing information.')
      setLoading(false)
      return
    }
    fetch(`/api/manage-booking?bookingId=${encodeURIComponent(bookingId)}&token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json()
        if (!res.ok) {
          setLoadError(data.error || 'This link is invalid or has expired.')
          return
        }
        setBooking(data)
      })
      .catch((err) => {
        console.error(err)
        Sentry.captureException(err)
        setLoadError('Something went wrong loading your booking.')
      })
      .finally(() => setLoading(false))
  }, [bookingId, token])

  const businessHours = date ? getBusinessHours(date) : null
  const availableStartTimes =
    date && booking && businessHours ? computeAvailableStartTimes(date, booking.totalMinutes, takenSlotTimes) : []

  useEffect(() => {
    if (!date) return
    setLoadingSlots(true)
    setStartMinutes('')
    const unsubscribe = listenToTakenSlotTimes(date, (times) => {
      setTakenSlotTimes(times)
      setLoadingSlots(false)
    })
    return unsubscribe
  }, [date])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!date || startMinutes === '') return

    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/reschedule-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, token, newDate: date, newStartMinutes: Number(startMinutes) }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(data.error || 'Something went wrong rescheduling your appointment.')
        return
      }
      setResult(data)
    } catch (err) {
      console.error('Error rescheduling booking:', err)
      Sentry.captureException(err)
      setSubmitError('Something went wrong rescheduling your appointment. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="owner-page">
        <p>Loading your booking…</p>
      </main>
    )
  }

  if (loadError) {
    return (
      <main className="owner-page">
        <h1>Manage your booking</h1>
        <p className="form-error">{loadError}</p>
      </main>
    )
  }

  if (result) {
    return (
      <main className="owner-page">
        <h1>You're all set!</h1>
        <p>
          Your appointment ({booking.reference}) is now scheduled for {result.date} &middot;{' '}
          {formatTime12h(hhmmToMinutes(result.startTime))} – {formatTime12h(hhmmToMinutes(result.endTime))}.
        </p>
      </main>
    )
  }

  return (
    <main className="owner-page">
      <h1>Manage your booking</h1>
      <p>
        <strong>{booking.reference}</strong> — {Array.isArray(booking.services) ? booking.services.join(', ') : booking.services}
      </p>
      <p>
        Currently: {booking.date} &middot; {formatTime12h(hhmmToMinutes(booking.startTime))} –{' '}
        {formatTime12h(hhmmToMinutes(booking.endTime))}
      </p>

      <form className="booking-form" onSubmit={handleSubmit} noValidate>
        <h2>Pick a new time</h2>

        <label className="form-field">
          Date
          <input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        {date && businessHours && (
          <label className="form-field">
            Start time
            {loadingSlots ? (
              <p>Checking availability…</p>
            ) : (
              <select value={startMinutes} onChange={(e) => setStartMinutes(e.target.value)}>
                <option value="">Choose a time</option>
                {availableStartTimes.map((m) => (
                  <option key={m} value={m}>
                    {formatTime12h(m)}
                  </option>
                ))}
              </select>
            )}
            {!loadingSlots && availableStartTimes.length === 0 && (
              <p className="field-error">No times available that day — try another date.</p>
            )}
          </label>
        )}
        {date && !businessHours && <p className="field-error">We're closed Sundays — please pick another date.</p>}

        {submitError && <p className="form-error">{submitError}</p>}

        <button className="btn-primary" type="submit" disabled={submitting || !date || startMinutes === ''}>
          {submitting ? 'Rescheduling…' : 'Confirm new time'}
        </button>
      </form>
    </main>
  )
}

export default ManageBooking
