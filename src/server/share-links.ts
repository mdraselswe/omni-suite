import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { invoices, proposals } from "@/server/db/schema";
import { appUrl } from "@/server/mail";

/**
 * Share links: a client without a portal login opens one invoice or proposal from
 * the email. The link holds a random token (192 bits), stored on the document;
 * staff can reset it, which stops the old link working.
 */
export type ShareKind = "invoice" | "proposal";

const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

export function newShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/** A token as it can appear in a link (anything else is not looked up at all). */
export function isShareToken(value: string): boolean {
  return TOKEN_RE.test(value);
}

export function sharePath(kind: ShareKind, token: string): `/p/${ShareKind}/${string}/` {
  return `/p/${kind}/${token}/`;
}

export function shareUrl(kind: ShareKind, token: string): string {
  return appUrl(sharePath(kind, token));
}

const tables = { invoice: invoices, proposal: proposals } as const;

/** The document's share token, made on first use. */
export async function ensureShareToken(
  tx: DbOrTx,
  kind: ShareKind,
  tenantId: string,
  id: string,
): Promise<string> {
  const table = tables[kind];
  const where = and(eq(table.id, id), eq(table.tenantId, tenantId));
  const [row] = await tx.select({ token: table.shareToken }).from(table).where(where);
  if (!row) throw new Error(`${kind} not found`);
  if (row.token) return row.token;
  const token = newShareToken();
  const [set] = await tx
    .update(table)
    .set({ shareToken: token })
    .where(and(where, isNull(table.shareToken)))
    .returning({ token: table.shareToken });
  if (set?.token) return set.token;
  // Another request made one at the same moment: use theirs.
  const [again] = await tx.select({ token: table.shareToken }).from(table).where(where);
  if (!again?.token) throw new Error("Share token missing");
  return again.token;
}

/** A new token: the old link stops working at once. */
export async function rotateShareToken(
  tx: DbOrTx,
  kind: ShareKind,
  tenantId: string,
  id: string,
): Promise<string> {
  const table = tables[kind];
  const token = newShareToken();
  const [row] = await tx
    .update(table)
    .set({ shareToken: token })
    .where(and(eq(table.id, id), eq(table.tenantId, tenantId)))
    .returning({ token: table.shareToken });
  if (!row?.token) throw new Error(`${kind} not found`);
  return token;
}
