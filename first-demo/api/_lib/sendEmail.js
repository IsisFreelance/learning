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
  manageLink,
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

  const manageTextBlock = manageLink
    ? `\n\nNeed a different time? Manage your booking here:\n${manageLink}`
    : ''
  const manageHtmlBlock = manageLink
    ? `<p><a href="${manageLink}">Manage or reschedule my booking</a></p>`
    : ''

  await sgMail.send({
    to,
    from: process.env.SENDER_EMAIL,
    subject: subject || defaultSubject,
    text: `Hi ${name},\n\nYour appointment is confirmed.\n\nReference: ${reference}\nServices: ${serviceList}\nDate: ${date}\nTime: ${startTime} - ${endTime}${confirmTextBlock}${calendarTextBlock}${manageTextBlock}\n\nWe look forward to seeing you.\n\nBright Harbor Dental`,
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
      ${manageHtmlBlock}
      <p>We look forward to seeing you.</p>
      <p>Bright Harbor Dental</p>
    `,
  })
}

export async function sendRescheduleEmail({
  to,
  name,
  reference,
  services,
  oldDate,
  oldStartTime,
  oldEndTime,
  date,
  startTime,
  endTime,
  manageLink,
}) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)

  const serviceList = services.join(', ')
  const manageTextBlock = manageLink ? `\n\nNeed to change it again? Manage your booking here:\n${manageLink}` : ''
  const manageHtmlBlock = manageLink ? `<p><a href="${manageLink}">Manage or reschedule my booking</a></p>` : ''

  await sgMail.send({
    to,
    from: process.env.SENDER_EMAIL,
    subject: `Bright Harbor Dental — Appointment Rescheduled (${reference})`,
    text: `Hi ${name},\n\nYour appointment has been rescheduled.\n\nReference: ${reference}\nServices: ${serviceList}\nPrevious time: ${oldDate} ${oldStartTime} - ${oldEndTime}\nNew time: ${date} ${startTime} - ${endTime}${manageTextBlock}\n\nWe look forward to seeing you.\n\nBright Harbor Dental`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your appointment has been rescheduled.</p>
      <ul>
        <li><strong>Reference:</strong> ${escapeHtml(reference)}</li>
        <li><strong>Services:</strong> ${escapeHtml(serviceList)}</li>
        <li><strong>Previous time:</strong> ${escapeHtml(oldDate)} ${escapeHtml(oldStartTime)} - ${escapeHtml(oldEndTime)}</li>
        <li><strong>New time:</strong> ${escapeHtml(date)} ${escapeHtml(startTime)} - ${escapeHtml(endTime)}</li>
      </ul>
      ${manageHtmlBlock}
      <p>We look forward to seeing you.</p>
      <p>Bright Harbor Dental</p>
    `,
  })
}

export async function sendReschedProposalEmail({
  to,
  name,
  reference,
  services,
  proposedDate,
  proposedStartTime,
  proposedEndTime,
  manageLink,
}) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)

  const serviceList = services.join(', ')

  await sgMail.send({
    to,
    from: process.env.SENDER_EMAIL,
    subject: `Bright Harbor Dental — Requesting to Reschedule Your Appointment (${reference})`,
    text: `Hi ${name},\n\nWe'd like to move your appointment to a new time.\n\nReference: ${reference}\nServices: ${serviceList}\nProposed new time: ${proposedDate} ${proposedStartTime} - ${proposedEndTime}\n\nIf that works for you, click below to accept it — or pick a different time if it doesn't:\n${manageLink}\n\nBright Harbor Dental`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>We'd like to move your appointment to a new time.</p>
      <ul>
        <li><strong>Reference:</strong> ${escapeHtml(reference)}</li>
        <li><strong>Services:</strong> ${escapeHtml(serviceList)}</li>
        <li><strong>Proposed new time:</strong> ${escapeHtml(proposedDate)} ${escapeHtml(proposedStartTime)} - ${escapeHtml(proposedEndTime)}</li>
      </ul>
      <p>If that works for you, click below to accept it — or pick a different time if it doesn't:</p>
      <p><a href="${manageLink}">Review this proposed time</a></p>
      <p>Bright Harbor Dental</p>
    `,
  })
}

export async function sendCancellationEmail({
  to,
  name,
  reference,
  services,
  date,
  startTime,
  endTime,
  depositNote,
  depositAmountCents,
}) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY)

  const serviceList = services.join(', ')
  const depositDollars = typeof depositAmountCents === 'number' ? (depositAmountCents / 100).toFixed(2) : null

  let depositTextBlock = ''
  let depositHtmlBlock = ''
  if (depositNote === 'refunded' && depositDollars) {
    depositTextBlock = `\n\nYour $${depositDollars} deposit has been refunded to your original payment method.`
    depositHtmlBlock = `<p>Your $${depositDollars} deposit has been refunded to your original payment method.</p>`
  } else if (depositNote === 'kept' && depositDollars) {
    depositTextBlock = `\n\nSince this was cancelled within 24 hours of your appointment, your $${depositDollars} deposit is non-refundable per our cancellation policy.`
    depositHtmlBlock = `<p>Since this was cancelled within 24 hours of your appointment, your $${depositDollars} deposit is non-refundable per our cancellation policy.</p>`
  }

  await sgMail.send({
    to,
    from: process.env.SENDER_EMAIL,
    subject: `Bright Harbor Dental — Appointment Cancelled (${reference})`,
    text: `Hi ${name},\n\nYour appointment has been cancelled.\n\nReference: ${reference}\nServices: ${serviceList}\nDate: ${date}\nTime: ${startTime} - ${endTime}${depositTextBlock}\n\nIf this wasn't expected, please contact us to reschedule:\n${PRACTICE_PHONE} · ${PRACTICE_CONTACT_EMAIL}\n\nBright Harbor Dental`,
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Your appointment has been cancelled.</p>
      <ul>
        <li><strong>Reference:</strong> ${escapeHtml(reference)}</li>
        <li><strong>Services:</strong> ${escapeHtml(serviceList)}</li>
        <li><strong>Date:</strong> ${escapeHtml(date)}</li>
        <li><strong>Time:</strong> ${escapeHtml(startTime)} - ${escapeHtml(endTime)}</li>
      </ul>
      ${depositHtmlBlock}
      <p>If this wasn't expected, please contact us to reschedule:<br>
      ${PRACTICE_PHONE} &middot; <a href="mailto:${PRACTICE_CONTACT_EMAIL}">${PRACTICE_CONTACT_EMAIL}</a></p>
      <p>Bright Harbor Dental</p>
    `,
  })
}
