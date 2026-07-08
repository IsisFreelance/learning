import { FieldValue } from 'firebase-admin/firestore'
import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { stripe } from './_lib/stripeClient.js'
import { finalizeBooking } from './_lib/finalizeBooking.js'

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
  const snap = await bookingRef.get()
  if (!snap.exists) {
    res.status(200).json({ ok: true })
    return
  }
  const booking = snap.data()

  // Stripe can and does deliver the same event more than once — this is
  // what makes a duplicate delivery a no-op instead of a second email and
  // calendar event.
  if (booking.depositStatus === 'paid') {
    res.status(200).json({ ok: true })
    return
  }

  try {
    await bookingRef.update({
      depositStatus: 'paid',
      stripePaymentIntentId: session.payment_intent,
      depositPaidAt: FieldValue.serverTimestamp(),
    })

    const updatedSnap = await bookingRef.get()
    await finalizeBooking(bookingRef, updatedSnap.data(), bookingId)

    res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Failed to process Stripe webhook:', err)
    Sentry.captureException(err)
    // A 500 tells Stripe to retry delivery — appropriate here since the
    // deposit was genuinely paid and the booking must reflect that.
    res.status(500).json({ error: 'Failed to process payment confirmation' })
  }
}
