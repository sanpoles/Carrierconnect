const nodemailer = require("nodemailer");

const env = require("../config/env");
const { pool } = require("../db/pool");

function getTransporter() {
  if (env.email.provider !== "smtp") {
    return null;
  }

  if (
    !env.email.smtpHost ||
    !env.email.smtpUser ||
    !env.email.smtpPassword
  ) {
    throw new Error(
      "SMTP email provider is enabled, but SMTP configuration is incomplete."
    );
  }

  return nodemailer.createTransport({
    host: env.email.smtpHost,
    port: env.email.smtpPort,
    secure: env.email.smtpSecure,
    auth: {
      user: env.email.smtpUser,
      pass: env.email.smtpPassword,
    },
  });
}

async function createEmailHistory({
  userId = null,
  requestId = null,
  sessionId = null,
  notificationType,
  recipientEmail,
  subject,
  provider,
  providerMessageId = null,
  deliveryStatus,
  errorMessage = null,
  sentAt = null,
}) {
  await pool.query(
    `
      INSERT INTO email_notification_history (
        user_id,
        request_id,
        session_id,
        notification_type,
        recipient_email,
        subject,
        provider,
        provider_message_id,
        delivery_status,
        error_message,
        sent_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
    `,
    [
      userId,
      requestId,
      sessionId,
      notificationType,
      recipientEmail,
      subject,
      provider,
      providerMessageId,
      deliveryStatus,
      errorMessage,
      sentAt,
    ]
  );
}

async function sendEmail({
  userId = null,
  requestId = null,
  sessionId = null,
  notificationType = "general",
  to,
  subject,
  text,
}) {
  const provider = env.email.provider;

  if (!to) {
    throw new Error("Email recipient is required.");
  }

  if (provider === "console") {
    console.log("\n========== CAREERCONNECT EMAIL ==========");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Message:\n${text}`);
    console.log("=========================================\n");

    await createEmailHistory({
      userId,
      requestId,
      sessionId,
      notificationType,
      recipientEmail: to,
      subject,
      provider: "console",
      deliveryStatus: "sent",
      sentAt: new Date(),
    });

    return {
      provider: "console",
      status: "sent",
    };
  }

  if (provider === "smtp") {
    try {
      const transporter = getTransporter();

      const info = await transporter.sendMail({
        from: env.email.from,
        to,
        subject,
        text,
      });

      await createEmailHistory({
        userId,
        requestId,
        sessionId,
        notificationType,
        recipientEmail: to,
        subject,
        provider: "smtp",
        providerMessageId: info.messageId || null,
        deliveryStatus: "sent",
        sentAt: new Date(),
      });

      return {
        provider: "smtp",
        status: "sent",
        messageId: info.messageId,
      };
    } catch (error) {
      await createEmailHistory({
        userId,
        requestId,
        sessionId,
        notificationType,
        recipientEmail: to,
        subject,
        provider: "smtp",
        deliveryStatus: "failed",
        errorMessage: error.message,
      });

      throw error;
    }
  }

  throw new Error(
    `Unsupported EMAIL_PROVIDER value: "${provider}". Use console or smtp.`
  );
}

async function sendPasswordResetEmail({
  userId,
  email,
  fullName,
  resetUrl,
}) {
  const subject = "Reset your CareerConnect password";

  const text = `Hello ${fullName},

We received a request to reset your CareerConnect password.

Use the secure link below to create a new password:

${resetUrl}

This link expires in ${env.passwordReset.ttlMinutes} minutes and can be used only once.

If you did not request a password reset, you can safely ignore this email.

CareerConnect Support`;

  return sendEmail({
    userId,
    notificationType: "general",
    to: email,
    subject,
    text,
  });
}

module.exports = {
  sendEmail,
  sendPasswordResetEmail,
};