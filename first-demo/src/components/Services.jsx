import { SERVICES } from '../data/services'

function Services() {
  return (
    <section className="services" id="services">
      <h2>Our Services</h2>
      <div className="services-grid">
        {SERVICES.map((service) => (
          <div className="service-card" key={service.name}>
            <h3>{service.name}</h3>
            <p>{service.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

export default Services
