import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'

// Real Firestore/Firebase Admin isn't reachable from a unit test — this
// fake store is enough to exercise the webhook's own logic (signature
// verification, idempotency, updating the right booking).
const bookingsStore = new Map()

function makeDocRef(id) {
  return {
    id,
    get: vi.fn(async () => ({
      exists: bookingsStore.has(id),
      data: () => bookingsStore.get(id),
    })),
    update: vi.fn(async (fields) => {
      bookingsStore.set(id, { ...bookingsStore.get(id), ...fields })
    }),
  }
}

// A minimal stand-in for Firestore transactions: `transaction.update` writes
// straight to the fake store (real transactions are also synchronous within
// the callback), and separate runTransaction() calls are chained one after
// another — approximating Firestore's serializable-transaction guarantee —
// so a test can tell "the check happens inside the transaction" apart from
// "the check happens before it" for two near-simultaneous calls.
let transactionChain = Promise.resolve()

const fakeAdminDb = {
  collection: vi.fn(() => ({
    doc: vi.fn((id) => makeDocRef(id)),
  })),
  runTransaction: vi.fn((updateFunction) => {
    const run = transactionChain.then(() =>
      updateFunction({
        get: async (ref) => ref.get(),
        update: (ref, fields) => {
          bookingsStore.set(ref.id, { ...bookingsStore.get(ref.id), ...fields })
        },
      })
    )
    transactionChain = run.then(
      () => {},
      () => {}
    )
    return run
  }),
}

vi.mock('./_lib/firebaseAdmin.js', () => ({ adminDb: fakeAdminDb }))
// The email/calendar side effects aren't what this test is about.
vi.mock('./_lib/finalizeBooking.js', () => ({ finalizeBooking: vi.fn() }))

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'
process.env.SENTRY_DSN = ''

const { default: handler } = await import('./stripe-webhook.js')
const { finalizeBooking } = await import('./_lib/finalizeBooking.js')

const stripeForSigning = new Stripe('sk_test_dummy')

function fakeReq(bodyString, headers) {
  return {
    method: 'POST',
    headers,
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(bodyString)
    },
  }
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}

function checkoutCompletedPayload(bookingId) {
  return JSON.stringify({
    id: 'evt_test_123',
    type: 'checkout.session.completed',
    data: {
      object: {
        payment_intent: 'pi_test_123',
        metadata: { bookingId },
      },
    },
  })
}

beforeEach(() => {
  bookingsStore.clear()
  vi.clearAllMocks()
  transactionChain = Promise.resolve()
})

describe('api/stripe-webhook', () => {
  it('rejects a request with an invalid signature', async () => {
    const res = fakeRes()
    await handler(fakeReq(checkoutCompletedPayload('booking1'), { 'stripe-signature': 'not-a-real-signature' }), res)

    expect(res.statusCode).toBe(400)
    expect(finalizeBooking).not.toHaveBeenCalled()
  })

  it('marks the deposit paid and finalizes the booking for a validly-signed event', async () => {
    bookingsStore.set('booking1', {
      depositStatus: 'pending_payment',
      date: '2099-01-01',
      startTime: '09:00',
    })

    const payload = checkoutCompletedPayload('booking1')
    const signature = stripeForSigning.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    })

    const res = fakeRes()
    await handler(fakeReq(payload, { 'stripe-signature': signature }), res)

    expect(res.statusCode).toBe(200)
    expect(bookingsStore.get('booking1').depositStatus).toBe('paid')
    expect(bookingsStore.get('booking1').stripePaymentIntentId).toBe('pi_test_123')
    expect(finalizeBooking).toHaveBeenCalledTimes(1)
  })

  it('is a no-op the second time the same event is delivered', async () => {
    bookingsStore.set('booking1', {
      depositStatus: 'pending_payment',
      date: '2099-01-01',
      startTime: '09:00',
    })

    const payload = checkoutCompletedPayload('booking1')
    const signature = stripeForSigning.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    })

    await handler(fakeReq(payload, { 'stripe-signature': signature }), fakeRes())
    const secondRes = fakeRes()
    await handler(fakeReq(payload, { 'stripe-signature': signature }), secondRes)

    expect(secondRes.statusCode).toBe(200)
    expect(finalizeBooking).toHaveBeenCalledTimes(1)
  })

  it('only finalizes once for two concurrent deliveries of the same event', async () => {
    bookingsStore.set('booking1', {
      depositStatus: 'pending_payment',
      date: '2099-01-01',
      startTime: '09:00',
    })

    const payload = checkoutCompletedPayload('booking1')
    const signature = stripeForSigning.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    })

    const res1 = fakeRes()
    const res2 = fakeRes()
    await Promise.all([
      handler(fakeReq(payload, { 'stripe-signature': signature }), res1),
      handler(fakeReq(payload, { 'stripe-signature': signature }), res2),
    ])

    expect(res1.statusCode).toBe(200)
    expect(res2.statusCode).toBe(200)
    expect(bookingsStore.get('booking1').depositStatus).toBe('paid')
    expect(finalizeBooking).toHaveBeenCalledTimes(1)
  })

  it('does not finalize a booking that has since been cancelled', async () => {
    bookingsStore.set('booking1', {
      depositStatus: 'pending_payment',
      status: 'Cancelled',
      date: '2099-01-01',
      startTime: '09:00',
    })

    const payload = checkoutCompletedPayload('booking1')
    const signature = stripeForSigning.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    })

    const res = fakeRes()
    await handler(fakeReq(payload, { 'stripe-signature': signature }), res)

    expect(res.statusCode).toBe(200)
    expect(bookingsStore.get('booking1').depositStatus).toBe('pending_payment')
    expect(finalizeBooking).not.toHaveBeenCalled()
  })

  it('does not finalize a booking whose appointment has already passed', async () => {
    bookingsStore.set('booking1', {
      depositStatus: 'pending_payment',
      date: '2020-01-01',
      startTime: '09:00',
      endTime: '09:30',
    })

    const payload = checkoutCompletedPayload('booking1')
    const signature = stripeForSigning.webhooks.generateTestHeaderString({
      payload,
      secret: process.env.STRIPE_WEBHOOK_SECRET,
    })

    const res = fakeRes()
    await handler(fakeReq(payload, { 'stripe-signature': signature }), res)

    expect(res.statusCode).toBe(200)
    expect(bookingsStore.get('booking1').depositStatus).toBe('pending_payment')
    expect(finalizeBooking).not.toHaveBeenCalled()
  })
})
