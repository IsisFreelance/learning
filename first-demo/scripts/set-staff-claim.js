// One-off local script: grants the "staff" custom claim to a Firebase Auth
// account by email. Run locally (never as a Vercel function) — see
// api/lib/firebaseAdmin.js's comment on why firebase-admin/auth can't load
// in this project's Vercel runtime.
//
// Usage: node scripts/set-staff-claim.js someone@example.com
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const envPath = path.join(__dirname, '..', '.env')
const raw = fs.readFileSync(envPath, 'utf8')
for (const line of raw.split(/\r?\n/)) {
  const eqIdx = line.indexOf('=')
  if (eqIdx === -1) continue
  const key = line.slice(0, eqIdx)
  let val = line.slice(eqIdx + 1)
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
  process.env[key] = val
}

const email = process.argv[2]
if (!email) {
  console.error('Usage: node scripts/set-staff-claim.js someone@example.com')
  process.exit(1)
}

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
    clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
})

const auth = getAuth(app)
const user = await auth.getUserByEmail(email)
await auth.setCustomUserClaims(user.uid, { staff: true })
console.log(`Granted staff claim to ${email} (uid: ${user.uid})`)
console.log('They need to log out and back in for it to take effect.')
