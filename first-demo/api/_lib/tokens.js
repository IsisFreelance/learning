import crypto from 'crypto'

export function generateConfirmToken() {
  return crypto.randomBytes(16).toString('hex')
}
