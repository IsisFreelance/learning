import Sentry from './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'
import { tokensMatch } from './_lib/tokens.js'
import { checkRateLimit, getClientIp, RateLimitError } from './_lib/rateLimit.js'

function htmlPage(title, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f4faf9; color: #33414A; text-align: center; padding: 4rem 1.5rem; }
    h1 { color: #2BB3A3; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${message}</p>
</body>
</html>`
}

export default async function handler(req, res) {
  const { bookingId, token } = req.query

  res.setHeader('Content-Type', 'text/html')

  try {
    await checkRateLimit(`confirm-appointment:${getClientIp(req)}`, { maxRequests: 15, windowMinutes: 5 })
  } catch (err) {
    if (err instanceof RateLimitError) {
      res.status(429).send(htmlPage('Too many attempts', err.message))
      return
    }
    console.error('Rate limit check failed:', err)
    Sentry.captureException(err)
  }

  if (!bookingId || !token) {
    res.status(400).send(htmlPage('Invalid link', 'This confirmation link is missing information.'))
    return
  }

  const bookingRef = adminDb.collection('bookings').doc(bookingId)
  const snap = await bookingRef.get()

  if (!snap.exists || !tokensMatch(token, snap.data().confirmToken)) {
    res.status(404).send(htmlPage('Link not found', "This confirmation link isn't valid or has already been used."))
    return
  }

  await bookingRef.update({ confirmedByPatient: true })

  res.status(200).send(
    htmlPage('You\'re all set!', 'Thanks for confirming — we look forward to seeing you at Bright Harbor Dental.')
  )
}
