const nodemailer = require('nodemailer');

async function sendOrderNotification(order) {
  const { MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_TO } = process.env;

  if (!MAIL_HOST || MAIL_HOST === 'smtp.example.com') {
    return { skipped: true, reason: 'Mail is not configured' };
  }

  const transporter = nodemailer.createTransport({
    host: MAIL_HOST,
    port: Number(MAIL_PORT || 587),
    secure: Number(MAIL_PORT || 587) === 465,
    auth: {
      user: MAIL_USER,
      pass: MAIL_PASS,
    },
  });

  await transporter.sendMail({
    from: MAIL_USER,
    to: MAIL_TO,
    subject: `Новая заявка: ${order.service || 'услуга'}`,
    text: `Имя: ${order.name}\nТелефон: ${order.phone}\nEmail: ${order.email || '—'}\nУслуга: ${order.service || '—'}\nСообщение: ${order.message || '—'}`,
  });

  return { skipped: false };
}

module.exports = { sendOrderNotification };
