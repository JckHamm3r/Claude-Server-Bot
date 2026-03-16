import db from "./db";

interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from_name: string;
  from_address: string;
  reply_to: string;
  enabled: boolean;
}

function getSmtpSettings(): SmtpSettings | null {
  try {
    const row = db
      .prepare("SELECT * FROM smtp_settings WHERE id = 1")
      .get() as Record<string, unknown> | undefined;
    if (!row || !row.enabled || !row.host) return null;
    return {
      host: row.host as string,
      port: row.port as number,
      secure: Boolean(row.secure),
      username: row.username as string,
      password: row.password as string,
      from_name: row.from_name as string,
      from_address: row.from_address as string,
      reply_to: row.reply_to as string,
      enabled: Boolean(row.enabled),
    };
  } catch {
    return null;
  }
}

export async function sendMail(
  to: string,
  subject: string,
  html: string
): Promise<void> {
  const smtp = getSmtpSettings();
  if (!smtp || !smtp.enabled || !smtp.host) return;

  try {
    // nodemailer is an optional runtime dependency. Use a plain require() so
    // bundlers can tree-shake it, and catch the error if it's not installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodemailer = require("nodemailer") as {
      createTransport: (config: unknown) => { sendMail: (opts: unknown) => Promise<unknown> };
    };
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth:
        smtp.username
          ? { user: smtp.username, pass: smtp.password }
          : undefined,
    });
    await transporter.sendMail({
      from: smtp.from_name
        ? `"${smtp.from_name}" <${smtp.from_address}>`
        : smtp.from_address,
      to,
      subject,
      html,
      replyTo: smtp.reply_to || undefined,
    });
  } catch (err) {
    console.error("[smtp] Failed to send mail:", err);
    throw err;
  }
}
