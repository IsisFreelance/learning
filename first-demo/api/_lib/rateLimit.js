import { Timestamp } from 'firebase-admin/firestore'
import { adminDb } from './firebaseAdmin.js'

export class RateLimitError extends Error {
  constructor() {
    super('Too many requests. Please try again later.')
    this.name = 'RateLimitError'
  }
}

// Vercel overwrites x-forwarded-for at the edge and does not forward
// client-supplied values through — trustworthy on this plan (see
// https://vercel.com/docs/headers/request-headers#x-forwarded-for).
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (!forwarded) return 'unknown'
  return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0].trim()
}

// Fixed-window counter per key (e.g. "notify:<ip>"), reusing the same
// transactional-counter pattern already used for booking reference numbers
// in src/lib/bookings.js. Each bucket carries an expiresAt field so a
// Firestore TTL policy can clean old buckets up automatically.
export async function checkRateLimit(key, { maxRequests, windowMinutes }) {
  const bucket = Math.floor(Date.now() / (windowMinutes * 60 * 1000))
  const docId = `${key}_${bucket}`.replace(/[/\s]/g, '_')
  const ref = adminDb.collection('rateLimits').doc(docId)

  await adminDb.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    const count = snap.exists ? snap.data().count : 0
    if (count >= maxRequests) {
      throw new RateLimitError()
    }
    transaction.set(ref, {
      count: count + 1,
      expiresAt: Timestamp.fromMillis(Date.now() + windowMinutes * 60 * 1000),
    })
  })
}
