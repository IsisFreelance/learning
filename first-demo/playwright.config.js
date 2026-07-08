import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: 'http://localhost:4173',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Redirects Firestore to the local emulator (see src/firebaseClient.js)
      // instead of the real production project — never set this in production.
      VITE_USE_FIRESTORE_EMULATOR: 'true',
      // hCaptcha's own published test site key — always resolves the widget
      // without a real bot-detection challenge. Safe to commit; it's public.
      VITE_HCAPTCHA_SITE_KEY: '10000000-ffff-ffff-ffff-000000000001',
      // Placeholder values only, same as .github/workflows/first-demo-ci.yml —
      // just need to look plausible so the Firebase SDK's format check
      // doesn't throw. No real Firebase project is contacted (emulator only).
      VITE_FIREBASE_API_KEY: 'ci-placeholder-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'ci-placeholder.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID: 'ci-placeholder',
    },
  },
})
