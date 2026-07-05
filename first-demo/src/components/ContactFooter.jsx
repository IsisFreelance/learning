function ContactFooter() {
  return (
    <footer className="contact-footer" id="contact">
      <div className="contact-info">
        <h2>Visit Us</h2>
        <p>123 Harbor View Lane, Bright Harbor, CA 94123</p>
        <p>(555) 012-3456 &middot; hello@brightharbordental.com</p>
        <p>Mon–Fri: 8am–6pm &middot; Sat: 9am–2pm</p>
      </div>
      <p className="copyright">
        &copy; {new Date().getFullYear()} Bright Harbor Dental. All rights reserved.
      </p>
      <p className="staff-login">
        <a href="/owner">Staff Login</a>
      </p>
    </footer>
  )
}

export default ContactFooter
