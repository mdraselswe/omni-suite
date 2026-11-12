import "server-only";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { aiConfig } from "@/config/ai";
import { runAi, type ChatTurn, type Completer } from "@/features/ai";
import { displayStatus, invoiceBalance, listInvoices } from "@/features/invoices";
import { listProjects } from "@/features/projects";
import { listProposals, proposalDisplayStatus } from "@/features/proposals";
import { updateSettings } from "@/features/settings";
import { t } from "@/i18n";
import { businessName } from "@/lib/business-name";
import { formatDate, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { portalAssistantFor, type PortalAssistantMode } from "@/lib/tenant-settings";
import { UserError } from "@/server/action";
import { aiConfigured } from "@/server/ai";
import type { Database, DbOrTx } from "@/server/db";
import { clients, memberships } from "@/server/db/schema";
import { consume, DAY_MS, release, type Rule } from "@/server/rate-limit";
import { audit } from "@/server/audit";
import { notify, usersWithPermission } from "@/server/shared";
import { hasPermission, PORTAL_ASSISTANT, type TenantContext } from "@/server/tenancy/context";
import {
  assistantPrompt,
  parseAssistantAnswer,
  trimHistory,
  type AssistantAnswer,
  type ClientFacts,
} from "./prompts";

const settings = aiConfig.portalAssistant;

/** Most recent records of each kind the assistant reads (older ones are on the portal pages). */
const RECENT = 25;

/** True when the business gives this portal member the assistant (setting, module and role). */
export function assistantAllowed(ctx: TenantContext): boolean {
  return (
    ctx.membership.kind === "client" &&
    hasPermission(ctx, PORTAL_ASSISTANT) &&
    portalAssistantFor(ctx.tenant.settings, ctx.membership.clientId)
  );
}

/** Allowed, and the server has an AI provider with a key for it. */
export function assistantReady(ctx: TenantContext): boolean {
  return assistantAllowed(ctx) && aiConfigured("portalAssistant");
}

function clientIdOf(ctx: TenantContext): string {
  const clientId = ctx.membership.clientId;
  // runAi checks the provider key; a fake completer in tests needs none.
  if (ctx.membership.kind !== "client" || !clientId || !assistantAllowed(ctx)) {
    throw new UserError(t("assistant.off"));
  }
  return clientId;
}

/**
 * This client's own account, as the assistant sees it: only what this person may open
 * in the portal (their invoices, proposals and projects), never another client's.
 */
export async function clientFacts(
  database: DbOrTx,
  ctx: TenantContext,
  clientId: string,
): Promise<ClientFacts> {
  const { settings: s } = ctx.tenant;
  const now = today(s.timezone);
  const money = (minor: bigint, currency: string) => formatMoney(minor, currency, s.locale);
  const date = (iso: string | null) => (iso ? formatDate(iso, s.locale) : "");
  const can = (p: string) => hasPermission(ctx, p);
  const [client] = await database
    .select({ name: clients.name })
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.tenantId, ctx.tenant.id)));

  const sections: ClientFacts["sections"][number][] = [];
  const pages: string[] = [t("nav.portal.home")];

  if (can("portal.invoices")) {
    pages.push(t("nav.portal.invoices"), t("statement.title"));
    const rows = await listInvoices(database, ctx.tenant.id, { clientId, portal: true, limit: RECENT });
    const owed = new Map<string, bigint>();
    const lines = rows.map(({ invoice: inv }) => {
      const balance = invoiceBalance(inv);
      if (balance > 0n) owed.set(inv.currency, (owed.get(inv.currency) ?? 0n) + balance);
      const status = displayStatus(inv, now).replace("_", " ");
      return (
        `Invoice ${inv.number}: ${status}, total ${money(inv.totalMinor, inv.currency)}, ` +
        `still owed ${money(balance, inv.currency)}, issued ${date(inv.issueDate)}, due ${date(inv.dueDate)}`
      );
    });
    sections.push({
      title: "Invoices (newest first)",
      lines: [
        `Total still owed: ${
          owed.size === 0 ? "nothing" : [...owed].map(([c, m]) => money(m, c)).join(" + ")
        }`,
        ...lines,
      ],
    });
  }

  if (can("portal.proposals")) {
    pages.push(t("nav.portal.proposals"));
    const rows = await listProposals(database, ctx.tenant.id, { clientId, portal: true, limit: RECENT });
    sections.push({
      title: "Proposals (newest first)",
      lines: rows.map(({ proposal: p }) => {
        const status = proposalDisplayStatus(p, now);
        const waiting = status === "sent" ? " (waiting for the client to accept or decline)" : "";
        return (
          `Proposal ${p.number} "${p.title}": ${status}${waiting}, total ${money(p.totalMinor, p.currency)}` +
          (p.validUntil ? `, valid until ${date(p.validUntil)}` : "")
        );
      }),
    });
  }

  if (can("portal.projects")) {
    pages.push(t("nav.portal.projects"));
    const statuses = s.projectStatuses;
    const rows = await listProjects(database, ctx, "all", { limit: RECENT });
    sections.push({
      title: "Projects (newest first)",
      lines: rows.map((p) => {
        const status = statuses.find((x) => x.key === p.status);
        return (
          `Project "${p.name}": ${status?.label ?? p.status}${status?.done ? " (finished)" : ""}, ` +
          `${p.doneCount} of ${p.taskCount} tasks done` +
          (p.dueDate ? `, due ${date(p.dueDate)}` : "")
        );
      }),
    });
  }
  if (can("portal.files")) pages.push(t("nav.portal.files"));

  return {
    businessName: businessName(ctx.tenant),
    clientName: client?.name ?? "",
    personName: ctx.user.name,
    today: date(now),
    pages,
    sections,
  };
}

const clientRule = (tenantId: string, clientId: string): Rule => ({
  key: `ai:client:${tenantId}:${clientId}`,
  limit: settings.dailyQuestionsPerClient,
  windowMs: DAY_MS,
});

/** One question to the assistant, with the conversation so far (kept in the browser). */
export async function askAssistant(
  database: Database,
  ctx: TenantContext,
  input: { question: string; history: readonly ChatTurn[] },
  completer?: Completer,
): Promise<AssistantAnswer> {
  const clientId = clientIdOf(ctx);
  // Per client (all its portal users together), on top of the member and business allowances.
  const rule = clientRule(ctx.tenant.id, clientId);
  if (!(await consume(database, rule))) {
    throw new UserError(t("assistant.limit", { limit: settings.dailyQuestionsPerClient }));
  }
  try {
    const facts = await clientFacts(database, ctx, clientId);
    const history = trimHistory(input.history, settings.historyMessages, settings.questionMaxLength * 2);
    return await runAi(
      database,
      ctx,
      assistantPrompt(facts, input.question, history),
      parseAssistantAnswer,
      completer,
    );
  } catch (error) {
    await release(database, rule);
    throw error;
  }
}

const handoffRule = (tenantId: string, clientId: string): Rule => ({
  key: `assistant:handoff:${tenantId}:${clientId}`,
  limit: settings.dailyHandoffsPerClient,
  windowMs: DAY_MS,
});

/** "Send to the team": the question reaches everyone who manages clients (in-app and email). */
export async function sendToTeam(database: Database, ctx: TenantContext, question: string): Promise<void> {
  const clientId = clientIdOf(ctx);
  if (!(await consume(database, handoffRule(ctx.tenant.id, clientId)))) {
    throw new UserError(t("assistant.handoffLimit", { limit: settings.dailyHandoffsPerClient }));
  }
  await database.transaction(async (tx) => {
    const [client] = await tx
      .select({ name: clients.name })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.tenantId, ctx.tenant.id)));
    await notify(tx, ctx.tenant.id, await usersWithPermission(tx, ctx.tenant.id, "clients.write"), {
      title: t("assistant.handoffTitle", { client: client?.name ?? "", person: ctx.user.name }),
      body: question,
      link: `/${ctx.tenant.slug}/clients/${clientId}`,
      email: true,
    });
    await audit(tx, {
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: "assistant.handoff",
      entityType: "client",
      entityId: clientId,
      data: { length: question.length },
    });
  });
}

/* ─── Settings: who gets the assistant ─────────────────────────── */

/** Saves the mode and the chosen clients (ids that aren't this business's clients are dropped). */
export async function setPortalAssistant(
  database: Database,
  ctx: TenantContext,
  input: { mode: PortalAssistantMode; clientIds: readonly string[] },
): Promise<void> {
  const wanted = [...new Set(input.clientIds)];
  const own =
    wanted.length === 0
      ? []
      : await database
          .select({ id: clients.id })
          .from(clients)
          .where(and(eq(clients.tenantId, ctx.tenant.id), inArray(clients.id, wanted)));
  await updateSettings(database, ctx, {
    settings: { portalAssistant: { mode: input.mode, clientIds: own.map((c) => c.id) } },
  });
}

/** Every client of the business with its number of active portal users (for the settings list). */
export async function assistantClientChoices(database: DbOrTx, tenantId: string) {
  const rows = await database
    .select({
      id: clients.id,
      name: clients.name,
      status: clients.status,
      portalUsers: count(memberships.id),
    })
    .from(clients)
    .leftJoin(
      memberships,
      and(
        eq(memberships.clientId, clients.id),
        eq(memberships.kind, "client"),
        eq(memberships.status, "active"),
      ),
    )
    .where(eq(clients.tenantId, tenantId))
    .groupBy(clients.id)
    .orderBy(asc(clients.name));
  return rows;
}
