import './instrument.js'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={<p style={{ textAlign: 'center', padding: '4rem 1.5rem' }}>Something went wrong. Please refresh the page.</p>}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
)
