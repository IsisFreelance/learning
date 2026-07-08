import { describe, it, expect } from 'vitest'
import { depositCentsForServices } from './services'

describe('depositCentsForServices', () => {
  it('sums the deposit for each selected service', () => {
    expect(depositCentsForServices(['Cleanings', 'Whitening'])).toBe(2500 + 5000)
  })

  it('returns 0 for no services selected', () => {
    expect(depositCentsForServices([])).toBe(0)
  })

  it('ignores an unrecognized service name', () => {
    expect(depositCentsForServices(['Not a real service'])).toBe(0)
  })
})
