// Verifies a Firebase Auth ID token AND that it belongs to an account with
// the "staff" custom claim (see scripts/set-staff-claim.js) — not just any
// logged-in account. Uses Google's public REST endpoint, avoiding
// firebase-admin/auth (whose JWKS-verification dependency chain isn't
// loadable in this Vercel runtime — see ERR_REQUIRE_ESM from jose).
export async function verifyStaffToken(idToken) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.VITE_FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  )
  if (!res.ok) return false
  const data = await res.json()
  const user = data.users?.[0]
  if (!user) return false
  const claims = JSON.parse(user.customAttributes || '{}')
  return claims.staff === true
}
