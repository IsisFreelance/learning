import { useState } from 'react'
import Hero from './components/Hero'
import Services from './components/Services'
import About from './components/About'
import ContactFooter from './components/ContactFooter'
import BookingModal from './components/BookingModal'
import OwnerDashboard from './components/OwnerDashboard'
import './App.css'

function App() {
  const [isBookingOpen, setIsBookingOpen] = useState(false)

  if (window.location.pathname === '/owner') {
    return <OwnerDashboard />
  }

  return (
    <>
      <Hero onBook={() => setIsBookingOpen(true)} />
      <Services />
      <About />
      <ContactFooter />
      {isBookingOpen && <BookingModal onClose={() => setIsBookingOpen(false)} />}
    </>
  )
}

export default App
