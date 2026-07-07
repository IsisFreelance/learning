import './_lib/sentry.js'
import { adminDb } from './_lib/firebaseAdmin.js'

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

  if (!bookingId || !token) {
    res.status(400).send(htmlPage('Invalid link', 'This confirmation link is missing information.'))
    return
  }

  const bookingRef = adminDb.collection('bookings').doc(bookingId)
  const snap = await bookingRef.get()

  if (!snap.exists || snap.data().confirmToken !== token) {
    res.status(404).send(htmlPage('Link not found', "This confirmation link isn't valid or has already been used."))
    return
  }

  await bookingRef.update({ confirmedByPatient: true })

  res.status(200).send(
    htmlPage('You\'re all set!', 'Thanks for confirming — we look forward to seeing you at Bright Harbor Dental.')
  )
}
