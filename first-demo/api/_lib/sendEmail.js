import sgMail from '@sendgrid/mail'
import { PRACTICE_PHONE, PRACTICE_CONTACT_EMAIL } from './calendarLink.js'

// Patient-supplied fields (name, services) end up in these HTML emails —
// without escaping, a name like "<img src=x onerror=...>" would run in
// whatever inbox opens it.
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function sendBookingEmail({
  to,
  name,
  reference,
  services,
  date,
  startTime,
  endTime,
  confirmLink,
  calendarLink,
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

  const calendarTextBlock = calendarLink
    ? `\n\nAdd this appointment to your Google Calendar:\n${calendarLink}`
    : ''
  const calendarHtmlBlock = calendarLink
    ? `<p><a href="${calendarLink}">Add to Google Calendar</a></p>`
    : ''

  await sgMail.send({
    to,
    from: process.env.SENDER_EMAIL,
    subject: subject || defaultSubject,
    text: `Hi ${name},\n\nYour appointment is confirmed.\n\nReference: ${reference}\nServices: ${serviceList}\nDate: ${date}\nTime: ${startTime} - ${endTime}${confirmTextBlock}${calendarTextBlock}\n\nWe look forward to seeing you.\n\nBright Harbor Dental`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your appointment is confirmed.</p>
      <ul>
        <li><strong>Reference:</strong> ${escapeHtml(reference)}</li>
        <li><strong>Services:</strong> ${escapeHtml(serviceList)}</li>
        <li><strong>Date:</strong> ${escapeHtml(date)}</li>
        <li><strong>Time:</strong> ${escapeHtml(startTime)} - ${escapeHtml(endTime)}</li>
      </ul>
      ${confirmHtmlBlock}
      ${calendarHtmlBlock}
      <p>We look forward to seeing you.</p>
      <p>Bright Harbor Dental</p>
    `,
  })
}

export async function sendCancellationEmail({ to, name, reference, services, date, startTime, endTime }) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)

  const serviceList = services.join(', ')

  await sgMail.send({
    to,
    from: process.env.SENDER_EMAIL,
    subject: `Bright Harbor Dental — Appointment Cancelled (${reference})`,
    text: `Hi ${name},\n\nYour appointment has been cancelled.\n\nReference: ${reference}\nServices: ${serviceList}\nDate: ${date}\nTime: ${startTime} - ${endTime}\n\nIf this wasn't expected, please contact us to reschedule:\n${PRACTICE_PHONE} · ${PRACTICE_CONTACT_EMAIL}\n\nBright Harbor Dental`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your appointment has been cancelled.</p>
      <ul>
        <li><strong>Reference:</strong> ${escapeHtml(reference)}</li>
        <li><strong>Services:</strong> ${escapeHtml(serviceList)}</li>
        <li><strong>Date:</strong> ${escapeHtml(date)}</li>
        <li><strong>Time:</strong> ${escapeHtml(startTime)} - ${escapeHtml(endTime)}</li>
      </ul>
      <p>If this wasn't expected, please contact us to reschedule:<br>
      ${PRACTICE_PHONE} &middot; <a href="mailto:${PRACTICE_CONTACT_EMAIL}">${PRACTICE_CONTACT_EMAIL}</a></p>
      <p>Bright Harbor Dental</p>
    `,
  })
}
