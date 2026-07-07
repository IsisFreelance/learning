import { useEffect, useState } from 'react'
import { SERVICES } from '../data/services'
import {
  computeAvailableStartTimes,
  createBooking,
  listenToTakenSlotTimes,
  formatTime12h,
  getBusinessHours,
  minutesToHHMM,
  SlotTakenError,
} from '../lib/bookings'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function BookingModal({ onClose }) {
  const [selectedServices, setSelectedServices] = useState([])
  const [date, setDate] = useState('')
  const [startMinutes, setStartMinutes] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  const [takenSlotTimes, setTakenSlotTimes] = useState([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [confirmation, setConfirmation] = useState(null)

  const totalMinutes = SERVICES.filter((s) => selectedServices.includes(s.name)).reduce(
    (sum, s) => sum + s.durationMinutes,
    0
  )

  const businessHours = date ? getBusinessHours(date) : null
  const availableStartTimes =
    date && totalMinutes > 0 ? computeAvailableStartTimes(date, totalMinutes, takenSlotTimes) : []

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

  function toggleService(serviceName) {
    setSelectedServices((prev) =>
      prev.includes(serviceName) ? prev.filter((s) => s !== serviceName) : [...prev, serviceName]
    )
    setStartMinutes('')
  }

  function validate() {
    const errors = {}
    if (selectedServices.length === 0) errors.services = 'Choose at least one service.'
    if (!date) errors.date = 'Choose a date.'
    else if (!businessHours) errors.date = "We're closed Sundays — please pick another date."
    else if (date < todayStr()) errors.date = 'Please choose a date in the future.'
    if (date && businessHours && startMinutes === '') errors.startTime = 'Choose a start time.'
    if (!name.trim()) errors.name = 'Enter your name.'
    if (!email.trim()) errors.email = 'Enter your email.'
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.'
    if (!phone.trim()) errors.phone = 'Enter your phone number.'
    return errors
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    setErrorMessage('')
    try {
      const { reference, bookingId } = await createBooking({
        services: selectedServices,
        totalMinutes,
        date,
        startMinutes: Number(startMinutes),
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
      })
      setConfirmation({
        reference,
        services: selectedServices,
        date,
        startMinutes: Number(startMinutes),
        totalMinutes,
        name: name.trim(),
      })

      // Best-effort notification — the booking already succeeded, so a failure here must not affect the UI.
      fetch('/api/notify-booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          to: email.trim(),
          name: name.trim(),
          reference,
          services: selectedServices,
          date,
          startTime: minutesToHHMM(Number(startMinutes)),
          endTime: minutesToHHMM(Number(startMinutes) + totalMinutes),
        }),
      }).catch(console.error)
    } catch (err) {
      if (err instanceof SlotTakenError) {
        // No manual refetch needed — the live listener above already reflects
        // the slot that was just taken.
        setErrorMessage(err.message)
        setStartMinutes('')
      } else {
        console.error('Error creating booking:', err)
        setErrorMessage('Something went wrong saving your booking. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>

        {confirmation ? (
          <div className="booking-confirmation">
            <h2>You're booked!</h2>
            <p className="confirmation-reference">{confirmation.reference}</p>
            <p>{confirmation.services.join(', ')}</p>
            <p>
              {confirmation.date} &middot; {formatTime12h(confirmation.startMinutes)} –{' '}
              {formatTime12h(confirmation.startMinutes + confirmation.totalMinutes)}
            </p>
            <p>Thanks, {confirmation.name} — we look forward to seeing you.</p>
            <button className="btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <form className="booking-form" onSubmit={handleSubmit} noValidate>
            <h2>Book an appointment</h2>

            <fieldset>
              <legend>Select service(s)</legend>
              {SERVICES.map((service) => (
                <label key={service.name} className="service-checkbox">
                  <input
                    type="checkbox"
                    checked={selectedServices.includes(service.name)}
                    onChange={() => toggleService(service.name)}
                  />
                  {service.name} ({service.durationMinutes} min)
                </label>
              ))}
              {totalMinutes > 0 && <p className="total-time">Total appointment time: {totalMinutes} min</p>}
              {fieldErrors.services && <p className="field-error">{fieldErrors.services}</p>}
            </fieldset>

            <label className="form-field">
              Date
              <input type="date" min={todayStr()} value={date} onChange={(e) => setDate(e.target.value)} />
              {fieldErrors.date && <p className="field-error">{fieldErrors.date}</p>}
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
                {!loadingSlots && totalMinutes > 0 && availableStartTimes.length === 0 && (
                  <p className="field-error">No times available that day — try another date.</p>
                )}
                {fieldErrors.startTime && <p className="field-error">{fieldErrors.startTime}</p>}
              </label>
            )}

            <label className="form-field">
              Name
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
              {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
            </label>

            <label className="form-field">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
            </label>

            <label className="form-field">
              Phone
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              {fieldErrors.phone && <p className="field-error">{fieldErrors.phone}</p>}
            </label>

            {errorMessage && <p className="form-error">{errorMessage}</p>}

            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Booking…' : 'Confirm booking'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default BookingModal
