import Stripe from 'stripe'

// One shared client, same lazy-singleton shape as api/_lib/firebaseAdmin.js —
// STRIPE_SECRET_KEY is a test-mode secret key (sk_test_...), server-only,
// never exposed to the frontend.
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
