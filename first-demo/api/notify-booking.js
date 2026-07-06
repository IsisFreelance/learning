import { sendBookingConfirmation } from './lib/sendEmail.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const booking = req.body

  try {
    await sendBookingConfirmation(booking)
  } catch (err) {
    console.error('Failed to send confirmation email:', err)
  }

  // Always respond success — a failed notification must never look like a failed booking.
  res.status(200).json({ ok: true })
}
