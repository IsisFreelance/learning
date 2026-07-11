import { useEffect, useRef, useState } from 'react'
import * as Sentry from '@sentry/react'
import HCaptcha from '@hcaptcha/react-hcaptcha'
import { SERVICES, depositCentsForServices } from '../data/services'
import {
  computeAvailableStartTimes,
  createBooking,
  listenToTakenSlotTimes,
  formatTime12h,
  getBusinessHours,
  minBookableDateStr,
  SlotTakenError,
} from '../lib/bookings'
import DateField from './DateField'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function formatDollars(cents) {
  return (cents / 100).toFixed(2)
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
  const [slotsError, setSlotsError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [captchaToken, setCaptchaToken] = useState('')
  const captchaRef = useRef(null)

  // Set once the booking itself is reserved — the slot is claimed at this
  // point no matter what happens with payment next, so this is kept
  // separate from the checkout/redirect step that follows it.
  const [reservedBooking, setReservedBooking] = useState(null)
  const [checkoutError, setCheckoutError] = useState('')
  const [startingCheckout, setStartingCheckout] = useState(false)

  const totalMinutes = SERVICES.filter((s) => selectedServices.includes(s.name)).reduce(
    (sum, s) => sum + s.durationMinutes,
    0
  )
  const depositCents = depositCentsForServices(selectedServices)

  const businessHours = date ? getBusinessHours(date) : null
  const availableStartTimes =
    date && totalMinutes > 0 ? computeAvailableStartTimes(date, totalMinutes, takenSlotTimes) : []

  useEffect(() => {
    if (!date) return
    setLoadingSlots(true)
    setSlotsError('')
    setStartMinutes('')
    const unsubscribe = listenToTakenSlotTimes(
      date,
      (times) => {
        setTakenSlotTimes(times)
        setLoadingSlots(false)
      },
      () => {
        setSlotsError("Couldn't check availability — please try again.")
        setLoadingSlots(false)
      }
    )
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
    else if (date < minBookableDateStr()) errors.date = 'Please choose a date starting tomorrow.'
    if (date && businessHours && startMinutes === '') errors.startTime = 'Choose a start time.'
    if (!name.trim()) errors.name = 'Enter your name.'
    if (!email.trim()) errors.email = 'Enter your email.'
    else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.'
    if (!phone.trim()) errors.phone = 'Enter your phone number.'
    if (!captchaToken) errors.captcha = 'Please complete the captcha.'
    return errors
  }

  // The one place that calls create-checkout-session — used both right
  // after a fresh booking is reserved and by the "try payment again"
  // retry button, so a checkout-session failure never requires re-doing
  // the booking itself (the slot is already claimed at that point).
  async function startCheckout(bookingId) {
    setStartingCheckout(true)
    setCheckoutError('')
    try {
      const res = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setCheckoutError('Something went wrong starting checkout. Please try again.')
        setStartingCheckout(false)
        return
      }
      // Full-page redirect to Stripe's hosted checkout — the app doesn't
      // need to handle payment details itself.
      window.location.href = data.url
    } catch (err) {
      console.error('Error starting checkout:', err)
      Sentry.captureException(err)
      setCheckoutError('Something went wrong starting checkout. Please try again.')
      setStartingCheckout(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const errors = validate()
    setFieldErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSubmitting(true)
    setErrorMessage('')
    try {
      const verifyRes = await fetch('/api/verify-captcha', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: captchaToken }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyData.ok) {
        setErrorMessage('Captcha verification failed. Please try again.')
        captchaRef.current?.resetCaptcha()
        setCaptchaToken('')
        setSubmitting(false)
        return
      }

      const { reference, bookingId } = await createBooking({
        services: selectedServices,
        totalMinutes,
        date,
        startMinutes: Number(startMinutes),
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
      })
      setReservedBooking({ reference, bookingId, depositCents })
      setSubmitting(false)
      await startCheckout(bookingId)
      return
    } catch (err) {
      // hCaptcha tokens are single-use — whatever happens below, get a fresh one for the retry.
      captchaRef.current?.resetCaptcha()
      setCaptchaToken('')

      if (err instanceof SlotTakenError) {
        // No manual refetch needed — the live listener above already reflects
        // the slot that was just taken.
        setErrorMessage(err.message)
        setStartMinutes('')
      } else {
        console.error('Error creating booking:', err)
        Sentry.captureException(err)
        setErrorMessage('Something went wrong saving your booking. Please try again.')
      }
    }
    setSubmitting(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          &times;
        </button>

        {reservedBooking ? (
          <div className="booking-confirmation">
            <h2>Your time is reserved!</h2>
            <p className="confirmation-reference">{reservedBooking.reference}</p>
            <p>
              A ${formatDollars(reservedBooking.depositCents)} deposit is required to confirm your appointment —
              you'll be redirected to our secure payment page.
            </p>
            {checkoutError && <p className="form-error">{checkoutError}</p>}
            <button
              className="btn-primary"
              type="button"
              onClick={() => startCheckout(reservedBooking.bookingId)}
              disabled={startingCheckout}
            >
              {startingCheckout ? 'Redirecting…' : 'Try payment again'}
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
              {depositCents > 0 && (
                <p className="total-time">Deposit due today: ${formatDollars(depositCents)}</p>
              )}
              {fieldErrors.services && <p className="field-error">{fieldErrors.services}</p>}
            </fieldset>

            <DateField value={date} onChange={setDate} error={fieldErrors.date} />

            {date && businessHours && (
              <label className="form-field">
                Start time
                {loadingSlots ? (
                  <p>Checking availability…</p>
                ) : slotsError ? (
                  <p className="field-error">{slotsError}</p>
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
                {!loadingSlots && !slotsError && totalMinutes > 0 && availableStartTimes.length === 0 && (
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

            <div className="form-field">
              <HCaptcha
                ref={captchaRef}
                sitekey={import.meta.env.VITE_HCAPTCHA_SITE_KEY}
                onVerify={setCaptchaToken}
                onExpire={() => setCaptchaToken('')}
              />
              {fieldErrors.captcha && <p className="field-error">{fieldErrors.captcha}</p>}
            </div>

            {errorMessage && <p className="form-error">{errorMessage}</p>}

            <button className="btn-primary" type="submit" disabled={submitting}>
              {submitting ? 'Reserving…' : 'Reserve & continue to payment'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

export default BookingModal
