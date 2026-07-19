import { useState } from 'react'
import { adminLogin, setToken } from '../api'

function AdminLogin({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      const token = await adminLogin(password)
      setToken(token)
      onLoggedIn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="login-screen">
      <h2>Admin login</h2>
      <form onSubmit={handleSubmit} className="login-form">
        <div className="review-field">
          <label htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        <button type="submit" disabled={submitting || !password}>
          Log in
        </button>
      </form>
    </section>
  )
}

export default AdminLogin
