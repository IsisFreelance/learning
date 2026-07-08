import { FieldValue } from 'firebase-admin/firestore'
import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { stripe } from './_lib/stripeClient.js'
import { finalizeBooking } from './_lib/finalizeBooking.js'
import { isBookingPast } from '../src/lib/scheduling.js'

// Stripe signs the raw request body — Vercel's default JSON body parser
// would already have re-serialized it by the time this handler runs,
// which breaks signature verification, so it's disabled for this one route.
export const config = {
  api: { bodyParser: false },
}

async function readRawBody(req) {
  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks)
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const signature = req.headers['stripe-signature']
  let event

  try {
    const rawBody = await readRawBody(req)
    // The one check that matters here: this cryptographically proves the
    // request really came from Stripe (signed with a secret only Stripe and
    // this server know), not from anyone who found this URL and POSTed a
    // fake "payment succeeded" event to unlock a booking for free.
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err)
    Sentry.captureException(err)
    res.status(400).json({ error: 'Invalid signature' })
    return
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledged but ignored — Stripe retries anything that isn't a 2xx.
    res.status(200).json({ ok: true })
    return
  }

  const session = event.data.object
  const bookingId = session.metadata?.bookingId
  if (!bookingId) {
    res.status(200).json({ ok: true })
    return
  }

  const bookingRef = adminDb.collection('bookings').doc(bookingId)

  try {
    // The "is this safe to finalize" check and the write that marks it
    // finalized happen atomically in one transaction — without that, two
    // near-simultaneous deliveries of the same event (Stripe's own docs
    // say duplicates happen) could both read "not paid yet" before either
    // writes, and both would go on to email the patient and create a
    // calendar event. This also doubles as the one place that decides a
    // stale checkout link (payable for up to an hour) can't resurrect a
    // booking that's since been cancelled or has already passed.
    let shouldFinalize = false
    await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(bookingRef)
      if (!snap.exists) return
      const booking = snap.data()

      if (booking.depositStatus === 'paid') return
      if (booking.status === 'Cancelled' || isBookingPast(booking)) return

      transaction.update(bookingRef, {
        depositStatus: 'paid',
        stripePaymentIntentId: session.payment_intent,
        depositPaidAt: FieldValue.serverTimestamp(),
      })
      shouldFinalize = true
    })

    if (shouldFinalize) {
      // finalizeBooking() makes real external API calls (SendGrid, Google
      // Calendar) that must never run twice from a transaction retry, so
      // it stays outside the transaction, using a fresh read of the now-paid booking.
      const updatedSnap = await bookingRef.get()
      await finalizeBooking(bookingRef, updatedSnap.data(), bookingId)
    }

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Failed to process Stripe webhook:', err)
    Sentry.captureException(err)
    // A 500 tells Stripe to retry delivery — appropriate here since the
    // deposit was genuinely paid and the booking must reflect that.
    res.status(500).json({ error: 'Failed to process payment confirmation' })
  }
}
