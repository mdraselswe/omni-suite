import "server-only";
import { and, eq } from "drizzle-orm";
import type { AiFeature } from "@/config";
import { pipelineSummary } from "@/features/crm";
import { cashPosition, monthlyTotals, profitAndLoss, runway } from "@/features/finance";
import { monthlyRecurring, receivables } from "@/features/invoices";
import { listProjects, myDueTasks } from "@/features/projects";
import { t } from "@/i18n";
import { addDays, addMonths, fiscalYearStart, monthStart, today } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { UserError } from "@/server/action";
import { aiConfigured } from "@/server/ai";
import { latestRate } from "@/server/fx";
import type { DbOrTx } from "@/server/db";
import { clients } from "@/server/db/schema";
import { hasPermission, isModuleEnabled, type TenantContext } from "@/server/tenancy/context";
import {
  insightsPrompt,
  parseInsights,
  parseProposalDraft,
  proposalDraftPrompt,
  type BusinessSnapshot,
  type Insight,
  type ProposalDraft,
} from "./prompts";
import { runAi, type Completer } from "./run";

/**
 * Whether this member sees AI features (provider key set, module on, permission held).
 * With a feature: whether that feature's provider is ready; without: whether any is.
 */
export function canUseAi(ctx: TenantContext, feature?: AiFeature): boolean {
  return aiConfigured(feature) && hasPermission(ctx, "ai.use");
}

/* ─── Proposal draft ───────────────────────────────────────────── */

export async function draftProposal(
  database: DbOrTx,
  ctx: TenantContext,
  input: { brief: string; clientId: string | null },
  completer?: Completer,
): Promise<ProposalDraft> {
  let clientName = "";
  if (input.clientId) {
    const [row] = await database
      .select({ name: clients.name })
      .from(clients)
      .where(and(eq(clients.id, input.clientId), eq(clients.tenantId, ctx.tenant.id)));
    clientName = row?.name ?? "";
  }
  const { settings } = ctx.tenant;
  const prompt = proposalDraftPrompt({
    businessName: ctx.tenant.name,
    clientName,
    currency: settings.currency,
    brief: input.brief,
    taxName: settings.tax.name,
    pricesIncludeTax: settings.tax.pricesIncludeTax,
  });
  return runAi(
    database,
    ctx,
    prompt,
    (text) => parseProposalDraft(text, settings.currency, settings.tax.rateBp),
    completer,
  );
}

/* ─── Business insights ────────────────────────────────────────── */

/**
 * The dashboard's headline numbers, using the same queries as the dashboard and
 * only what this member may see. Totals only: no client or person names.
 */
export async function businessSnapshot(database: DbOrTx, ctx: TenantContext): Promise<BusinessSnapshot> {
  const { settings } = ctx.tenant;
  const now = today(settings.timezone);
  const money = (minor: bigint) => formatMoney(minor, settings.currency, settings.locale);
  const facts: { label: string; value: string }[] = [];
  const tenantId = ctx.tenant.id;

  if (hasPermission(ctx, "finance.read")) {
    const [position, month, fy, spend] = await Promise.all([
      cashPosition(
        database,
        tenantId,
        settings.currency,
        async (foreign, base) => (await latestRate(foreign, base))?.rate ?? null,
      ),
      profitAndLoss(database, tenantId, monthStart(now), now),
      profitAndLoss(database, tenantId, fiscalYearStart(now, settings.fiscalYearStartMonth), now),
      monthlyTotals(database, tenantId, monthStart(addMonths(now, -3)), addDays(monthStart(now), -1)),
    ]);
    const cash = position.totalMinor;
    const burn = runway(cash, spend);
    const avgSpend = burn.avgSpendMinor;
    facts.push(
      { label: "Cash in accounts (all currencies at today's rate)", value: money(cash) },
      ...position.unconverted.map((u) => ({
        label: `Also held in ${u.currency} (no rate today, not in the cash total)`,
        value: formatMoney(u.minor, u.currency, settings.locale),
      })),
      { label: "Income this month", value: money(month.incomeMinor) },
      { label: "Spending this month", value: money(month.expenseMinor) },
      { label: "Profit this month", value: money(month.profitMinor) },
      { label: "Profit this financial year", value: money(fy.profitMinor) },
      { label: `Average monthly spending (last ${Math.max(burn.months, 1)} months)`, value: money(avgSpend) },
      {
        label: "Cash runway",
        value: burn.runway !== null ? `${burn.runway} months` : "no recent spending",
      },
    );
  }
  if (hasPermission(ctx, "invoices.read")) {
    const [owed, mrr] = await Promise.all([
      receivables(database, tenantId, now, settings.currency),
      monthlyRecurring(database, ctx),
    ]);
    facts.push(
      { label: "Unpaid invoices (total owed)", value: money(owed.totalMinor) },
      { label: "Of which overdue", value: money(owed.overdueMinor) },
      { label: "Monthly recurring revenue", value: money(mrr) },
    );
  }
  if (isModuleEnabled(ctx, "crm") && hasPermission(ctx, "leads.read")) {
    const pipeline = await pipelineSummary(database, ctx);
    facts.push({
      label: "Sales pipeline (open leads)",
      value: `${pipeline.count} leads worth ${money(pipeline.valueMinor)}`,
    });
  }
  if (isModuleEnabled(ctx, "projects")) {
    const scope = ctx.permissions.get("projects.read");
    const [projects, tasks] = await Promise.all([
      scope ? listProjects(database, ctx, scope) : Promise.resolve(null),
      myDueTasks(database, ctx, addDays(now, 7)),
    ]);
    if (projects) {
      const done = new Set(settings.projectStatuses.filter((s) => s.done).map((s) => s.key));
      facts.push({
        label: "Active projects",
        value: String(projects.filter((p) => !done.has(p.status)).length),
      });
    }
    facts.push({
      label: "My overdue tasks",
      value: String(tasks.filter(({ task }) => task.dueDate !== null && task.dueDate < now).length),
    });
  }
  return { businessName: ctx.tenant.name, today: now, facts };
}

export async function businessInsights(
  database: DbOrTx,
  ctx: TenantContext,
  completer?: Completer,
): Promise<Insight[]> {
  const snapshot = await businessSnapshot(database, ctx);
  if (snapshot.facts.length === 0) throw new UserError(t("ai.noData"));
  return runAi(database, ctx, insightsPrompt(snapshot), parseInsights, completer);
}
