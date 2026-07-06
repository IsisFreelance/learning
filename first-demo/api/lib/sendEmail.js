import sgMail from '@sendgrid/mail'

export async function sendBookingConfirmation({ to, name, reference, services, date, startTime, endTime }) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)

  const serviceList = services.join(', ')

  await sgMail.send({
    to,
    from: process.env.SENDER_EMAIL,
    subject: `Bright Harbor Dental — Appointment Confirmed (${reference})`,
    text: `Hi ${name},\n\nYour appointment is confirmed.\n\nReference: ${reference}\nServices: ${serviceList}\nDate: ${date}\nTime: ${startTime} - ${endTime}\n\nWe look forward to seeing you.\n\nBright Harbor Dental`,
    html: `
      <p>Hi ${name},</p>
      <p>Your appointment is confirmed.</p>
      <ul>
        <li><strong>Reference:</strong> ${reference}</li>
        <li><strong>Services:</strong> ${serviceList}</li>
        <li><strong>Date:</strong> ${date}</li>
        <li><strong>Time:</strong> ${startTime} - ${endTime}</li>
      </ul>
      <p>We look forward to seeing you.</p>
      <p>Bright Harbor Dental</p>
    `,
  })
}
