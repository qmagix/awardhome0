require('dotenv').config();
const { sendEmail } = require('./utils/mailer');

async function testEmail() {
  const provider = (process.env.EMAIL_PROVIDER || 'gmail').toLowerCase();
  const recipient = process.argv[2] || 'delivered@resend.dev';

  console.log(`Testing Email Provider: ${provider.toUpperCase()}`);
  console.log(`Attempting to send a test email to: ${recipient}`);

  const result = await sendEmail({
    to: recipient,
    subject: '✅ Dance Awards - Email Integration Test',
    html: `
      <div style="font-family: sans-serif; padding: 20px;">
        <h2>Email Integration is Working!</h2>
        <p>If you are reading this, your ${provider.toUpperCase()} email provider is properly configured.</p>
      </div>
    `
  });

  if (result.success) {
    console.log("✅ Success! Email sent.");
    console.log("Response data:", result.data);
  } else {
    console.error("❌ Error sending email:", result.error);
  }
}

testEmail();
