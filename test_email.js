require('dotenv').config();
const { Resend } = require('resend');

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  console.error("❌ Error: RESEND_API_KEY is not defined in your .env file.");
  process.exit(1);
}

const resend = new Resend(apiKey);

async function testEmail() {
  // If a command-line argument is provided, use it as the recipient email.
  // Otherwise, use 'delivered@resend.dev' which is Resend's safe testing address.
  const recipient = process.argv[2] || 'delivered@resend.dev';

  console.log(`Testing Resend API Key: ${apiKey.substring(0, 8)}...`);
  console.log(`Attempting to send a test email to: ${recipient}`);

  try {
    const { data, error } = await resend.emails.send({
      from: 'onboarding@resend.dev',
      to: recipient,
      subject: '✅ Dance Awards - Resend Test',
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>Resend API is Working!</h2>
          <p>If you are reading this, your RESEND_API_KEY is properly configured.</p>
        </div>
      `
    });

    if (error) {
      console.error("❌ Error sending email:", error);
    } else {
      console.log("✅ Success! Email sent.");
      console.log("Response data:", data);
    }
  } catch (err) {
    console.error("❌ Caught Exception:", err);
  }
}

testEmail();
