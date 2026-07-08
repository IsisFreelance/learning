import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Default stays Node (untouched for existing unit/rules tests) — each
    // component test file opts into a simulated browser via its own
    // `// @vitest-environment jsdom` comment instead.
    setupFiles: ['./src/test-setup.js'],
  },
})
