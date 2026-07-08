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

const fakeAdminDb = {
  collection: vi.fn(() => ({
    doc: vi.fn((id) => makeDocRef(id)),
  })),
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
})
