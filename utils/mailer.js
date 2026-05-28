require('dotenv').config();
const { Resend } = require('resend');
const nodemailer = require('nodemailer');

const emailProvider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();

let resend;
let transporter;

if (emailProvider === 'resend' && process.env.RESEND_API_KEY) {
  resend = new Resend(process.env.RESEND_API_KEY);
} else if (emailProvider === 'gmail') {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

/**
 * Sends an email using the configured provider (Gmail or Resend).
 * @param {Object} options 
 * @param {string} options.to - Recipient email address
 * @param {string} options.subject - Email subject
 * @param {string} options.html - Email body (HTML)
 * @returns {Promise<{success: boolean, data?: any, error?: any}>}
 */
async function sendEmail({ to, subject, html }) {
  if (emailProvider === 'resend') {
    if (!resend) {
      console.error("[Mailer] Resend API Key is missing. Email not sent.");
      return { success: false, error: "Missing RESEND_API_KEY" };
    }
    try {
      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev',
        to,
        subject,
        html,
      });
      if (error) {
        console.error("[Mailer] Resend Error:", error);
        return { success: false, error };
      }
      return { success: true, data };
    } catch (err) {
      console.error("[Mailer] Resend Exception:", err);
      return { success: false, error: err };
    }
  } else if (emailProvider === 'gmail') {
    if (!transporter) {
      console.error("[Mailer] Gmail credentials missing. Email not sent.");
      return { success: false, error: "Missing GMAIL_USER or GMAIL_APP_PASSWORD" };
    }
    try {
      const info = await transporter.sendMail({
        from: process.env.GMAIL_USER,
        to,
        subject,
        html,
      });
      return { success: true, data: info };
    } catch (err) {
      console.error("[Mailer] Gmail Error:", err);
      return { success: false, error: err };
    }
  } else {
    console.error(`[Mailer] Unknown EMAIL_PROVIDER: ${emailProvider}`);
    return { success: false, error: `Unknown provider: ${emailProvider}` };
  }
}

module.exports = { sendEmail };
