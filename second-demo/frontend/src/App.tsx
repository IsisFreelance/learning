import { useEffect, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

type HealthState = { status: 'loading' } | { status: 'ok' } | { status: 'error'; message: string }

function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' })

  useEffect(() => {
    fetch(`${API_BASE_URL}/health`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then(() => setHealth({ status: 'ok' }))
      .catch((err) => setHealth({ status: 'error', message: err.message }))
  }, [])

  return (
    <main style={{ fontFamily: 'sans-serif', padding: '3rem', maxWidth: '480px', margin: '0 auto' }}>
      <h1>Catalog Intake</h1>
      <p>Phase 0 — foundations. This page just proves the frontend can reach the backend and the backend can reach the database.</p>
      <p>
        Backend says:{' '}
        {health.status === 'loading' && 'checking…'}
        {health.status === 'ok' && <strong>ok</strong>}
        {health.status === 'error' && <strong>error — {health.message}</strong>}
      </p>
    </main>
  )
}

export default App
