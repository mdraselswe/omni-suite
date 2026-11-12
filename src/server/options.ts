import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { DbOrTx } from "@/server/db";
import { accounts, categories, clients, memberships, partners, projects, user } from "@/server/db/schema";

/** Small option lists for selects. All scoped to one tenant. */
export async function clientOptions(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select({ value: clients.id, label: clients.name })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.status, "active")))
    .orderBy(asc(clients.name));
  return rows;
}

export async function memberOptions(
  database: DbOrTx,
  tenantId: string,
  kind: "internal" | "client" = "internal",
) {
  return database
    .select({ value: memberships.id, label: user.name })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(
      and(eq(memberships.tenantId, tenantId), eq(memberships.kind, kind), eq(memberships.status, "active")),
    )
    .orderBy(asc(user.name));
}

export async function partnerOptions(database: DbOrTx, tenantId: string) {
  return database
    .select({ value: partners.id, label: partners.name })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), isNull(partners.leftOn)))
    .orderBy(asc(partners.name));
}

export async function accountOptions(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select({ value: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.tenantId, tenantId), eq(accounts.archived, false)))
    .orderBy(asc(accounts.createdAt));
  return rows.map((r) => ({ value: r.value, label: `${r.name} (${r.currency})`, currency: r.currency }));
}

export async function categoryOptions(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select({ value: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.tenantId, tenantId), eq(categories.archived, false)))
    .orderBy(asc(categories.name));
  return rows;
}

export async function projectOptions(database: DbOrTx, tenantId: string) {
  return database
    .select({ value: projects.id, label: projects.name })
    .from(projects)
    .where(eq(projects.tenantId, tenantId))
    .orderBy(asc(projects.name));
}
