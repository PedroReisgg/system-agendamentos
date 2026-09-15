import nodemailer from 'nodemailer';

export async function sendVerificationEmail(email, token) {
  const url = `${process.env.FRONTEND_URL}?verifyToken=${token}`;
  if (!process.env.SMTP_HOST) {
    console.info(`Verification URL for ${email}: ${url}`);
    return { delivered: false, url };
  }
  const transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465), secure: process.env.SMTP_SECURE === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await transporter.sendMail({ from: process.env.MAIL_FROM, to: email, subject: 'Confirme seu e-mail', html: `<p>Confirme seu cadastro: <a href="${url}">validar e-mail</a></p>` });
  return { delivered: true, url: null };
}
