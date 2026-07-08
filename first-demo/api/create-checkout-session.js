import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { stripe } from './_lib/stripeClient.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'
import { depositCentsForServices } from '../src/data/services.js'
import { isBookingPast } from '../src/lib/scheduling.js'

const CHECKOUT_EXPIRY_SECONDS = 60 * 60 // 1 hour — short enough that the daily
// cleanup cron (api/expire-unpaid-holds.js) can never run into a still-valid
// checkout session for the same booking.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    await checkRateLimit(`checkout:${getClientIp(req)}`, { maxRequests: 15, windowMinutes: 5 })
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).json({ error: err.message })
      return
    }
    console.error('Rate limit check failed:', err)
    Sentry.captureException(err)
  }

  // Only bookingId is trusted from the client — the deposit amount is
  // always computed here from the booking's real services, never taken
  // from the request, so there's no way to check out for less than owed.
  const { bookingId } = req.body
  if (typeof bookingId !== 'string' || !bookingId) {
    res.status(400).json({ error: 'Missing bookingId' })
    return
  }

  const bookingRef = adminDb.collection('bookings').doc(bookingId)
  const snap = await bookingRef.get()
  if (!snap.exists) {
    res.status(404).json({ error: 'Booking not found' })
    return
  }
  const booking = snap.data()

  if (booking.depositStatus === 'paid') {
    res.status(200).json({ ok: true, alreadyPaid: true })
    return
  }

  // Defense in depth — the webhook is the authoritative gate on this (a
  // checkout link can stay payable for up to an hour, so this check alone
  // wouldn't be enough), but there's no reason to hand out a dead-end
  // payment link for a booking that's already cancelled or over.
  if (booking.status === 'Cancelled' || isBookingPast(booking)) {
    res.status(410).json({ error: 'This booking is no longer available for payment.' })
    return
  }

  const depositCents = depositCentsForServices(booking.services)

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: depositCents,
            product_data: { name: `Appointment deposit — ${booking.reference}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.PUBLIC_BASE_URL}/booking-confirmed?bookingId=${bookingId}`,
      cancel_url: `${process.env.PUBLIC_BASE_URL}/`,
      metadata: { bookingId },
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRY_SECONDS,
    })

    await bookingRef.update({
      depositStatus: 'pending_payment',
      depositAmountCents: depositCents,
      stripeCheckoutSessionId: session.id,
    })

    res.status(200).json({ ok: true, url: session.url })
  } catch (err) {
    console.error('Failed to create Stripe checkout session:', err)
    Sentry.captureException(err)
    res.status(500).json({ error: 'Something went wrong starting checkout. Please try again.' })
  }
}
