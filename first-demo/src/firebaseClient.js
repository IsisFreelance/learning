import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Firebase Auth is deliberately NOT initialized here — it's only needed by
// the staff dashboard, kept in firebaseAuthClient.js so public visitors
// (who only need Firestore, for booking) never download that code.
export const app = initializeApp(firebaseConfig)

// App Check proves requests are coming from this real app, not a script
// hitting Firestore directly with a copied API key. Only enforced against
// Firestore for now (not the Vercel API routes — verifying App Check tokens
// server-side would need firebase-admin's App Check verifier, which risks
// the same jose/JWKS crash already hit once in this project).
//
// Guarded to a real browser context: the reCAPTCHA provider injects a
// script tag and needs `document`, so this would crash under Vitest (no DOM)
// even with every env var set — `typeof document !== 'undefined'` is always
// true in an actual browser and never true in Node/test environments.
if (typeof document !== 'undefined') {
  if (import.meta.env.DEV) {
    // Lets `npm run dev` work without a real reCAPTCHA challenge. Never set in production.
    globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = true
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  })
}

// Persistent local cache: recently-seen data stays available (read-only)
// even if the connection drops, and queued writes sync automatically once
// back online. Multiple-tab-aware since staff may have the dashboard open
// in more than one tab.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
