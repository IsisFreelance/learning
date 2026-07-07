import { initializeApp } from 'firebase/app'
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

// Persistent local cache: recently-seen data stays available (read-only)
// even if the connection drops, and queued writes sync automatically once
// back online. Multiple-tab-aware since staff may have the dashboard open
// in more than one tab.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
})
