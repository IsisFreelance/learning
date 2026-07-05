function Hero({ onBook }) {
  return (
    <header className="hero">
      <div className="hero-inner">
        <h1>Your smile, our passion.</h1>
        <p className="hero-subhead">
          Modern, gentle dental care for the whole family — right here in Bright Harbor.
        </p>
        <button className="btn-primary" onClick={onBook}>
          Book an appointment
        </button>
      </div>
    </header>
  )
}

export default Hero
