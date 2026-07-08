import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Component tests render into a shared jsdom document — without this,
// each test's rendered DOM stays mounted for the next test in the same
// file, causing "found multiple elements" failures.
afterEach(() => {
  cleanup()
})
