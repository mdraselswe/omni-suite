import "server-only";
import { createHash } from "node:crypto";
import { limits } from "@/config";
import { t } from "@/i18n";
import { UserError } from "@/server/action";
import type { DbOrTx } from "@/server/db";
import { consume, consumeAll, DAY_MS, HOUR_MS, type Rule } from "@/server/rate-limit";

/**
 * Mail quotas, so the app can't be used as a relay to arbitrary addresses:
 * - a business may queue only so many emails per hour and per day;
 * - account emails (password reset, verification) and mail with no business
 *   behind it are throttled per recipient instead.
 */

export function businessMailRules(tenantId: string): Rule[] {
  return [
    { key: `mail:tenant:${tenantId}:day`, limit: limits.mail.perBusinessPerDay, windowMs: DAY_MS },
    { key: `mail:tenant:${tenantId}:hour`, limit: limits.mail.perBusinessPerHour, windowMs: HOUR_MS },
  ];
}

export function recipientMailRule(email: string): Rule {
  const hash = createHash("sha256").update(email.trim().toLowerCase()).digest("base64url");
  return { key: `mail:to:${hash}`, limit: limits.mail.perRecipientPerHour, windowMs: HOUR_MS };
}

/**
 * Takes one email from the business's allowance. Throws a UserError naming the
 * limit when it is used up, or returns false with `onLimit: "skip"`.
 */
export async function takeBusinessMail(
  database: DbOrTx,
  tenantId: string,
  onLimit: "throw" | "skip" = "throw",
): Promise<boolean> {
  const full = await consumeAll(database, businessMailRules(tenantId));
  if (!full) return true;
  if (onLimit === "skip") return false;
  const hourly = full.windowMs === HOUR_MS;
  throw new UserError(t(hourly ? "security.mailLimitHour" : "security.mailLimitDay", { limit: full.limit }));
}

/** Takes one email from a recipient's hourly allowance. False when used up. */
export async function takeRecipientMail(database: DbOrTx, email: string): Promise<boolean> {
  return consume(database, recipientMailRule(email));
}
