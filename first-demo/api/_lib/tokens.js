import crypto from 'crypto'

export function generateConfirmToken() {
  return crypto.randomBytes(16).toString('hex')
}

// Constant-time comparison — a plain === exits on the first differing
// character, a real (if narrow) timing side-channel for guessing a secret
// token byte-by-byte. timingSafeEqual throws on mismatched lengths, so
// length is checked first (that check itself doesn't leak anything useful:
// every real token is the same fixed length).
export function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}
