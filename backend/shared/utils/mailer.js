import nodemailer from "nodemailer";

let transporter = null;

function getTransporter() {
  if (!process.env.SMTP_HOST) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  return transporter;
}

// Sends the reset email. With no SMTP configured (development) the link is logged to
// the server console instead. Never throws: the API answer must not reveal failures.
export async function sendPasswordResetEmail(to, name, link) {
  const mail = getTransporter();

  if (!mail) {
    console.log(`[password reset] SMTP not configured. Reset link for ${to}: ${link}`);
    return false;
  }

  try {
    await mail.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject: "Reset your Bannu Drive password",
      text: `Hello ${name},\n\nUse this link to set a new password (valid for 30 minutes):\n${link}\n\nIf you did not ask for this, ignore this email.`
    });
    return true;
  } catch (error) {
    console.error("Reset email failed:", error.message);
    return false;
  }
}
