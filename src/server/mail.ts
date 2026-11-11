import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { serverEnv } from "@/config/env";

const globalForMail = globalThis as unknown as { __omnisuiteMail?: Transporter };

function transport(): Transporter {
  globalForMail.__omnisuiteMail ??= nodemailer.createTransport(serverEnv().SMTP_URL);
  return globalForMail.__omnisuiteMail;
}

export type MailMessage = { to: string; subject: string; text: string; html?: string };

/**
 * Sends an email now. Failures are logged, never thrown: mail must not break the
 * action that triggered it (links are always shown in the app as well). Inside a
 * transaction use `queueMail` (src/server/shared.ts) instead, so mail only goes out
 * after the commit and survives a restart. `messageId` lets a retried send reuse
 * the same Message-ID, so mail servers can drop the duplicate.
 */
export async function sendMail(message: MailMessage & { messageId?: string }): Promise<boolean> {
  try {
    await transport().sendMail({ from: serverEnv().MAIL_FROM, ...message });
    return true;
  } catch (error) {
    console.error("[mail] send failed", error);
    return false;
  }
}

/** Absolute app URL for links in emails. */
export function appUrl(path: string): string {
  return `${serverEnv().APP_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
