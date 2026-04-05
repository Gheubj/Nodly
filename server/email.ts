import nodemailer from "nodemailer";
import { config } from "./config.js";

const devLog = process.env.EMAIL_DEV_LOG === "true" || process.env.NODE_ENV !== "production";

function isConfigured(): boolean {
  if (config.emailProvider === "smtp") {
    return Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
  }
  return Boolean(config.resendApiKey);
}

async function sendViaResend(to: string, subject: string, html: string, text: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [to],
      subject,
      html,
      text
    })
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error: ${res.status} ${body}`);
  }
}

async function sendViaSmtp(to: string, subject: string, html: string, text: string) {
  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass
    }
  });
  await transport.sendMail({
    from: config.emailFrom,
    to,
    subject,
    text,
    html
  });
}

async function deliver(to: string, subject: string, html: string, text: string) {
  if (!isConfigured()) {
    if (devLog) {
      // eslint-disable-next-line no-console
      console.warn("[email] not configured — dev log only:\n", text);
      return;
    }
    throw new Error("Отправка почты не настроена: задайте RESEND_API_KEY или SMTP_* в .env");
  }
  if (config.emailProvider === "smtp") {
    await sendViaSmtp(to, subject, html, text);
  } else {
    await sendViaResend(to, subject, html, text);
  }
}

export async function sendRegistrationCode(email: string, code: string) {
  const subject = "Код подтверждения Noda";
  const text = `Ваш код для регистрации: ${code}\n\nКод действует ${config.registrationOtpTtlMin} минут.`;
  const html = `<p>Ваш код для регистрации: <strong>${code}</strong></p><p>Код действует ${config.registrationOtpTtlMin} минут.</p>`;
  await deliver(email, subject, html, text);
}

export async function sendPasswordResetLink(email: string, resetUrl: string) {
  const subject = "Сброс пароля Noda";
  const text = `Перейдите по ссылке, чтобы задать новый пароль (действует ${config.passwordResetTtlMin} мин):\n${resetUrl}\n\nЕсли вы не запрашивали сброс, проигнорируйте письмо.`;
  const html = `<p>Перейдите по ссылке, чтобы задать новый пароль (действует ${config.passwordResetTtlMin} мин):</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>Если вы не запрашивали сброс, проигнорируйте письмо.</p>`;
  await deliver(email, subject, html, text);
}

export async function sendStudentNewAssignmentEmail(
  studentEmail: string,
  args: { assignmentTitle: string; classTitle: string; appUrl: string }
) {
  const subject = `Новое задание: ${args.assignmentTitle}`;
  const text = `В классе «${args.classTitle}» опубликовано задание «${args.assignmentTitle}».\n\nОткройте раздел «Класс» на сайте: ${args.appUrl}`;
  const html = `<p>В классе <strong>${args.classTitle}</strong> опубликовано задание <strong>${args.assignmentTitle}</strong>.</p><p><a href="${args.appUrl}">Открыть кабинет</a></p>`;
  await deliver(studentEmail, subject, html, text);
}

export async function sendTeacherSubmissionEmail(
  teacherEmail: string,
  args: { studentNickname: string; assignmentTitle: string; appUrl: string }
) {
  const subject = `Сдана работа: ${args.assignmentTitle}`;
  const text = `Ученик ${args.studentNickname} сдал задание «${args.assignmentTitle}».\n\nПроверка: ${args.appUrl}`;
  const html = `<p>Ученик <strong>${args.studentNickname}</strong> сдал задание <strong>${args.assignmentTitle}</strong>.</p><p><a href="${args.appUrl}">Открыть кабинет учителя</a></p>`;
  await deliver(teacherEmail, subject, html, text);
}

export async function sendStudentGradedEmail(
  studentEmail: string,
  args: { assignmentTitle: string; score: number; maxScore: number; appUrl: string; comment?: string | null }
) {
  const subject = `Оценка: ${args.assignmentTitle}`;
  const scoreLine = `Балл: ${args.score} из ${args.maxScore}.`;
  const commentBlock = args.comment ? `\n\nКомментарий учителя:\n${args.comment}` : "";
  const text = `По заданию «${args.assignmentTitle}» выставлена оценка. ${scoreLine}${commentBlock}\n\nОткрыть раздел «Класс»: ${args.appUrl}`;
  const html = `<p>По заданию <strong>${args.assignmentTitle}</strong> выставлена оценка: <strong>${args.score}</strong> из ${args.maxScore}.</p>${
    args.comment ? `<p>Комментарий учителя:<br/>${args.comment.replace(/\n/g, "<br/>")}</p>` : ""
  }<p><a href="${args.appUrl}">Открыть кабинет</a></p>`;
  await deliver(studentEmail, subject, html, text);
}

export async function sendTeacherNewStudentEmail(
  teacherEmail: string,
  args: { studentNickname: string; classTitle: string; appUrl: string }
) {
  const subject = `Новый ученик в классе «${args.classTitle}»`;
  const text = `${args.studentNickname} присоединился к классу «${args.classTitle}».\n\nКабинет учителя: ${args.appUrl}`;
  const html = `<p><strong>${args.studentNickname}</strong> присоединился к классу <strong>${args.classTitle}</strong>.</p><p><a href="${args.appUrl}">Открыть кабинет</a></p>`;
  await deliver(teacherEmail, subject, html, text);
}
