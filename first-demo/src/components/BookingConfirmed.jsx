// The page Stripe redirects back to after a successful deposit payment.
// Deliberately simple: the bookingId in the URL isn't a secret (it isn't
// used to look anything up here), and the webhook — not this page — is
// the real source of truth that the payment succeeded, so there's nothing
// trustworthy to fetch and display yet by the time this renders.
function BookingConfirmed() {
  return (
    <main className="owner-page">
      <h1>Payment received!</h1>
      <p>Thanks — your deposit has been received and your appointment is confirmed.</p>
      <p>You'll get a confirmation email shortly with all the details.</p>
    </main>
  )
}

export default BookingConfirmed
