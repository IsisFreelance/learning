import { Suspense, lazy, useEffect, useState } from 'react'
import Hero from './components/Hero'
import Services from './components/Services'
import About from './components/About'
import ContactFooter from './components/ContactFooter'
import BookingModal from './components/BookingModal'
import './App.css'

// Lazy-loaded so public visitors never download the staff dashboard's code
// (including Firebase Auth) — only fetched when someone actually visits /owner.
const OwnerDashboard = lazy(() => import('./components/OwnerDashboard'))

// Lazy-loaded too — only fetched by someone who actually opens a
// "manage my booking" link from their confirmation email.
const ManageBooking = lazy(() => import('./components/ManageBooking'))

// Lazy-loaded too — only fetched by someone actually redirected back from
// a real Stripe checkout, not every visitor.
const BookingConfirmed = lazy(() => import('./components/BookingConfirmed'))

function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine)

  useEffect(() => {
    const goOffline = () => setIsOffline(true)
    const goOnline = () => setIsOffline(false)
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [])

  if (!isOffline) return null
  return <div className="offline-banner">You're offline — changes will sync once you're back online.</div>
}

function App() {
  const [isBookingOpen, setIsBookingOpen] = useState(false)

  if (window.location.pathname === '/owner') {
    return (
      <Suspense fallback={null}>
        <OfflineBanner />
        <OwnerDashboard />
      </Suspense>
    )
  }

  if (window.location.pathname === '/manage-booking') {
    return (
      <Suspense fallback={null}>
        <OfflineBanner />
        <ManageBooking />
      </Suspense>
    )
  }

  if (window.location.pathname === '/booking-confirmed') {
    return (
      <Suspense fallback={null}>
        <OfflineBanner />
        <BookingConfirmed />
      </Suspense>
    )
  }

  return (
    <>
      <OfflineBanner />
      <Hero onBook={() => setIsBookingOpen(true)} />
      <Services />
      <About />
      <ContactFooter />
      {isBookingOpen && <BookingModal onClose={() => setIsBookingOpen(false)} />}
    </>
  )
}

export default App
