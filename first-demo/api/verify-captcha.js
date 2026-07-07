import './_lib/sentry.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { token } = req.body
  if (!token) {
    res.status(400).json({ ok: false })
    return
  }

  const params = new URLSearchParams({
    secret: process.env.HCAPTCHA_SECRET_KEY,
    response: token,
  })

  const verifyRes = await fetch('https://api.hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const data = await verifyRes.json()

  res.status(200).json({ ok: Boolean(data.success) })
}
