import sgMail from '@sendgrid/mail'

export async function sendBookingEmail({
  to,
  name,
  reference,
  services,
  date,
  startTime,
  endTime,
  confirmLink,
  subject,
}) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)

  const serviceList = services.join(', ')
  const defaultSubject = `Bright Harbor Dental — Appointment Confirmed (${reference})`

  const confirmTextBlock = confirmLink
    ? `\n\nPlease confirm you're still coming by visiting this link:\n${confirmLink}`
    : ''
  const confirmHtmlBlock = confirmLink
    ? `<p>Please confirm you're still coming:</p><p><a href="${confirmLink}">Confirm my appointment</a></p>`
    : ''

  await sgMail.send({
    to,
    from: process.env.SENDER_EMAIL,
    subject: subject || defaultSubject,
    text: `Hi ${name},\n\nYour appointment is confirmed.\n\nReference: ${reference}\nServices: ${serviceList}\nDate: ${date}\nTime: ${startTime} - ${endTime}${confirmTextBlock}\n\nWe look forward to seeing you.\n\nBright Harbor Dental`,
    html: `
      <p>Hi ${name},</p>
      <p>Your appointment is confirmed.</p>
      <ul>
        <li><strong>Reference:</strong> ${reference}</li>
        <li><strong>Services:</strong> ${serviceList}</li>
        <li><strong>Date:</strong> ${date}</li>
        <li><strong>Time:</strong> ${startTime} - ${endTime}</li>
      </ul>
      ${confirmHtmlBlock}
      <p>We look forward to seeing you.</p>
      <p>Bright Harbor Dental</p>
    `,
  })
}
