import "server-only";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/features/auth";
import { createClient, listTemplates, sendOnboarding } from "@/features/clients";
import { createLead } from "@/features/crm";
import { createAccount, createTransaction, listCategories } from "@/features/finance";
import { createInvoice, createRecurring, recordPayment, sendInvoice } from "@/features/invoices";
import {
  createPartner,
  decideRule,
  proposeRule,
  recordCapital,
  setInitialOwnership,
} from "@/features/partners";
import {
  addComment,
  createProject,
  createTask,
  listProjectTemplates,
  listTasks,
  logTime,
  setProjectMember,
  setRate,
  updateTask,
} from "@/features/projects";
import { createProposal, invoiceFromProposal, respondToProposal, sendProposal } from "@/features/proposals";
import { addDays, addMonths, monthStart, today as todayIn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import type { LineItem } from "@/lib/line-items";
import type { Database, DbOrTx } from "@/server/db";
import { account, memberRoles, memberships, roles, tenants, user } from "@/server/db/schema";
import { bumpPermissionsVersion } from "@/server/rbac/service";
import type { TenantContext } from "@/server/tenancy/context";
import { buildTenantContext, createTenant } from "@/server/tenancy/service";

/**
 * Local demo data (sample only — no real people, partners or money).
 * Creates the "demo" business with one sign-in per default role, and an empty
 * "omniscope" business owned by the platform admin emails. Safe to run twice.
 */

export const DEMO_SLUG = "demo";
export const HOME_SLUG = "omniscope";

const item = (description: string, quantity: string, dollars: number): LineItem => ({
  description,
  quantity,
  unitPriceMinor: String(dollars * 100),
  taxRateBp: 1000,
});

async function ensureUser(
  database: Database,
  email: string,
  name: string,
  password?: string,
): Promise<string> {
  const [existing] = await database.select({ id: user.id }).from(user).where(eq(user.email, email));
  if (existing) return existing.id;
  const id = uuidv7();
  await database.insert(user).values({ id, name, email, emailVerified: true });
  if (password) {
    await database.insert(account).values({
      id: uuidv7(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: await hashPassword(password),
    });
  }
  return id;
}

async function addMembership(
  tx: DbOrTx,
  tenantId: string,
  userId: string,
  roleKey: string,
  extra: { kind?: "internal" | "client"; clientId?: string | null; title?: string } = {},
): Promise<string> {
  const [m] = await tx
    .insert(memberships)
    .values({
      tenantId,
      userId,
      kind: extra.kind ?? "internal",
      clientId: extra.clientId ?? null,
      title: extra.title ?? "",
    })
    .returning({ id: memberships.id });
  const [role] = await tx
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, roleKey)));
  if (!m || !role) throw new Error(`Seed: membership for role ${roleKey} failed`);
  await tx.insert(memberRoles).values({ membershipId: m.id, roleId: role.id });
  await bumpPermissionsVersion(tx, tenantId);
  return m.id;
}

async function contextFor(database: Database, slug: string, userId: string): Promise<TenantContext> {
  const result = await buildTenantContext(database, slug, userId, false);
  if (!result.ok) throw new Error(`Seed: no context for ${slug}`);
  return result.ctx;
}

async function tenantExists(database: Database, slug: string): Promise<boolean> {
  const [row] = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug));
  return Boolean(row);
}

export type SeedResult = { demo: "created" | "exists"; home: "created" | "exists" | "skipped" };

export async function seed(
  database: Database,
  options: { adminEmails: readonly string[]; timezone?: string },
): Promise<SeedResult> {
  const result: SeedResult = { demo: "exists", home: "skipped" };
  const tz = options.timezone ?? "Australia/Sydney";
  const today = todayIn(tz);

  const adminIds: string[] = [];
  for (const email of options.adminEmails)
    adminIds.push(await ensureUser(database, email, email.split("@")[0] ?? email));

  if (adminIds[0]) {
    result.home = "exists";
    if (!(await tenantExists(database, HOME_SLUG))) {
      await createTenant(database, { name: "OmniScope Digital", slug: HOME_SLUG, ownerUserId: adminIds[0] });
      result.home = "created";
    }
  }

  if (await tenantExists(database, DEMO_SLUG)) return result;
  result.demo = "created";

  const ids: Record<string, string> = {};
  for (const a of DEMO_ACCOUNTS) ids[a.email] = await ensureUser(database, a.email, a.name, DEMO_PASSWORD);
  const uid = (email: string) => {
    const id = ids[email];
    if (!id) throw new Error(`Seed: missing ${email}`);
    return id;
  };

  const { tenantId } = await createTenant(database, {
    name: "Demo Agency Pty Ltd",
    slug: DEMO_SLUG,
    ownerUserId: uid("owner@demo.test"),
    settings: {
      tax: { name: "GST", rateBp: 1000, pricesIncludeTax: false, registrationNumber: "00 000 000 000" },
    },
  });
  const m = await database.transaction(async (tx) => ({
    partner: await addMembership(tx, tenantId, uid("partner@demo.test"), "owner", { title: "Partner" }),
    manager: await addMembership(tx, tenantId, uid("manager@demo.test"), "manager", {
      title: "Project manager",
    }),
    staff: await addMembership(tx, tenantId, uid("staff@demo.test"), "staff", { title: "Web developer" }),
    accountant: await addMembership(tx, tenantId, uid("accountant@demo.test"), "accountant", {
      title: "Bookkeeper",
    }),
    admins: await Promise.all(
      adminIds.map((id) => addMembership(tx, tenantId, id, "owner", { title: "Platform owner" })),
    ),
  }));

  const owner = await contextFor(database, DEMO_SLUG, uid("owner@demo.test"));
  const partnerCtx = await contextFor(database, DEMO_SLUG, uid("partner@demo.test"));

  /* Money */
  const bank = await createAccount(database, owner, {
    name: "Business bank",
    type: "bank",
    currency: "AUD",
    openingBalanceMinor: 0n,
  });
  const cats = await listCategories(database, tenantId);
  const cat = (name: string) => cats.find((c) => c.name === name)?.id ?? null;

  /* Partners: 60/40 start, capital 30k + 20k, capital-ratio profit rule with a 10% reserve. */
  const start = monthStart(addMonths(today, -8));
  const pA = await createPartner(database, owner, {
    name: "Ayesha Rahman",
    email: "owner@demo.test",
    joinedOn: start,
    membershipId: owner.membership.id,
  });
  const pB = await createPartner(database, owner, {
    name: "Tanvir Hasan",
    email: "partner@demo.test",
    joinedOn: start,
    membershipId: m.partner,
  });
  await setInitialOwnership(database, owner, {
    date: start,
    shares: [
      { partnerId: pA, basisPoints: 6000 },
      { partnerId: pB, basisPoints: 4000 },
    ],
    note: "Founding split (sample)",
  });
  await recordCapital(database, owner, {
    partnerId: pA,
    date: start,
    kind: "cash",
    amountMinor: 3_000_000n,
    description: "Initial capital",
    accountId: bank,
  });
  await recordCapital(database, owner, {
    partnerId: pB,
    date: start,
    kind: "cash",
    amountMinor: 2_000_000n,
    description: "Initial capital",
    accountId: bank,
  });
  const ruleId = await proposeRule(database, owner, {
    config: { reserveBp: 1000, fees: [], method: { type: "capital_ratio" }, lossMethod: "same_as_profit" },
    effectiveFrom: start,
    note: "Split by capital, keep 10% in the business",
  });
  await decideRule(database, partnerCtx, { ruleId, partnerId: pB, decision: "approved" });

  /* Monthly running costs for the last 8 months. */
  for (let k = 7; k >= 0; k--) {
    const day = addDays(monthStart(addMonths(today, -k)), 2);
    if (day > today) continue;
    const spend: [string, string, number][] = [
      ["Software & tools", "Hosting, design and email tools", 189],
      ["Advertising", "Google & Meta ads", k % 2 === 0 ? 650 : 420],
      ["Contractors", "Freelance copywriter", k % 3 === 0 ? 900 : 0],
      ["Bank fees", "Monthly account fee", 10],
    ];
    for (const [category, description, dollars] of spend) {
      if (dollars === 0) continue;
      await createTransaction(database, owner, {
        kind: "expense",
        accountId: bank,
        categoryId: cat(category),
        date: day,
        description,
        amountMinor: BigInt(dollars * 100),
      });
    }
  }

  /* Clients */
  const clientInput = (name: string, email: string, website: string, address: string) => ({
    name,
    email,
    phone: "0400 000 000",
    website,
    address,
    notes: "Sample client",
    status: "active" as const,
    custom: {},
  });
  const cafe = await createClient(
    database,
    owner,
    clientInput("Harbour Cafe", "hello@harbourcafe.example", "harbourcafe.example", "1 Wharf St, Sydney NSW"),
  );
  const plumbing = await createClient(
    database,
    owner,
    clientInput(
      "Coastal Plumbing",
      "jobs@coastalplumbing.example",
      "coastalplumbing.example",
      "Wollongong NSW",
    ),
  );
  const fitness = await createClient(
    database,
    owner,
    clientInput("Bondi Fitness Studio", "team@bondifit.example", "bondifit.example", "Bondi NSW"),
  );
  const dental = await createClient(
    database,
    owner,
    clientInput("Koala Dental", "admin@koaladental.example", "", "Parramatta NSW"),
  );
  await database.transaction((tx) =>
    addMembership(tx, tenantId, uid("client@demo.test"), "client_owner", { kind: "client", clientId: cafe }),
  );

  /* Leads */
  const leads: [string, string, string, number][] = [
    ["Mia Chen", "Sunrise Bakery", "new", 2500],
    ["Liam Brown", "Brown Electrical", "call", 4000],
    ["Olivia Smith", "Smith Legal", "proposal", 8500],
    ["Noah Taylor", "Taylor Physio", "pilot", 3000],
    ["Emma Davis", "Davis Florist", "won", 1800],
  ];
  for (const [name, company, stage, dollars] of leads) {
    await createLead(database, owner, {
      name,
      company,
      email: `${name.split(" ")[0]?.toLowerCase() ?? "lead"}@example.com`,
      phone: "",
      source: "Website form",
      stage,
      valueMinor: BigInt(dollars * 100),
      notes: "",
      ownerMembershipId: null,
      custom: {},
    });
  }

  /* Monthly retainer invoices for the cafe, all paid. */
  for (let k = 5; k >= 1; k--) {
    const issue = monthStart(addMonths(today, -k));
    const id = await createInvoice(database, owner, {
      clientId: cafe,
      issueDate: issue,
      dueDate: addDays(issue, 14),
      items: [item("Website care & SEO retainer", "1", 1500)],
      notes: "",
      custom: {},
    });
    await sendInvoice(database, owner, id);
    await recordPayment(database, owner, id, {
      amountMinor: 165_000n,
      date: addDays(issue, 9),
      accountId: bank,
      method: "Bank transfer",
      categoryId: cat("Retainers"),
    });
  }

  /* Proposal accepted by Coastal Plumbing → invoice, half paid. */
  const proposal = await createProposal(database, owner, {
    clientId: plumbing,
    title: "New website and local SEO",
    intro: "A fast, mobile-first website with local SEO for the Illawarra region.",
    terms: "50% deposit to start, 50% on launch.",
    items: [item("Website design & build (8 pages)", "1", 4800), item("Local SEO setup", "1", 1200)],
    validUntil: addDays(today, 30),
  });
  await sendProposal(database, owner, proposal);
  await respondToProposal(database, owner, proposal, { accept: true, name: "Sam Coastal", ip: "", today });
  const projectInvoice = await invoiceFromProposal(database, owner, proposal, addDays(today, -20));
  await sendInvoice(database, owner, projectInvoice);
  await recordPayment(database, owner, projectInvoice, {
    amountMinor: 330_000n,
    date: addDays(today, -15),
    accountId: bank,
    method: "Bank transfer",
    categoryId: cat("Services"),
  });

  /* An overdue invoice, a draft and an open proposal. */
  const overdue = await createInvoice(database, owner, {
    clientId: fitness,
    issueDate: addDays(today, -40),
    dueDate: addDays(today, -26),
    items: [item("Social media content pack", "1", 900)],
    notes: "",
    custom: {},
  });
  await sendInvoice(database, owner, overdue);
  await createInvoice(database, owner, {
    clientId: dental,
    issueDate: today,
    dueDate: addDays(today, 14),
    items: [item("Google Business Profile setup", "1", 450)],
    notes: "",
    custom: {},
  });
  const openProposal = await createProposal(database, owner, {
    clientId: dental,
    title: "Patient booking website",
    intro: "Online booking, reviews and a clear services page.",
    terms: "Valid for 30 days.",
    items: [item("Website with booking", "1", 3900)],
    validUntil: addDays(today, 21),
  });
  await sendProposal(database, owner, openProposal);

  await createRecurring(database, owner, {
    clientId: cafe,
    name: "Website care retainer",
    intervalMonths: 1,
    nextRunDate: monthStart(addMonths(today, 1)),
    items: [item("Website care & SEO retainer", "1", 1500)],
    autoSend: false,
  });

  /* Projects, tasks, rates and time. */
  const [template] = await listProjectTemplates(database, tenantId);
  const website = await createProject(database, owner, {
    name: "Coastal Plumbing website",
    description: "8-page site with local SEO.",
    clientId: plumbing,
    status: "active",
    startDate: addDays(today, -20),
    dueDate: addDays(today, 25),
    budgetMinor: 600_000n,
    custom: {},
    templateId: template?.id ?? null,
  });
  const cafeCare = await createProject(database, owner, {
    name: "Harbour Cafe care plan",
    description: "Monthly updates, SEO and reporting.",
    clientId: cafe,
    status: "active",
    startDate: monthStart(addMonths(today, -5)),
    dueDate: null,
    budgetMinor: 0n,
    custom: {},
    templateId: null,
  });
  for (const projectId of [website, cafeCare]) {
    await setProjectMember(database, owner, { projectId, membershipId: m.staff, add: true });
    await setProjectMember(database, owner, { projectId, membershipId: m.manager, add: true });
  }
  const websiteTasks = await listTasks(database, owner, website);
  const progress = ["done", "done", "in_progress", "todo", "todo", "todo", "todo"] as const;
  for (const [i, row] of websiteTasks.entries()) {
    const status = progress[i] ?? "todo";
    await updateTask(database, owner, "all", row.task.id, {
      status,
      assigneeMembershipId: i % 2 ? m.staff : m.manager,
    });
  }
  const homepage = await createTask(database, owner, "all", cafeCare, {
    title: "New winter menu page",
    description: "Add the winter menu with photos.",
    status: "todo",
    assigneeMembershipId: m.staff,
    dueDate: addDays(today, 3),
    clientVisible: true,
    needsApproval: true,
  });
  await updateTask(database, owner, "all", homepage, { status: "review" });
  await createTask(database, owner, "all", cafeCare, {
    title: "Monthly SEO report",
    description: "",
    status: "in_progress",
    assigneeMembershipId: m.manager,
    dueDate: addDays(today, 5),
    clientVisible: false,
    needsApproval: false,
  });
  await addComment(database, owner, {
    projectId: cafeCare,
    body: "Menu photos received, thanks!",
    clientVisible: true,
  });

  await setRate(database, owner, { membershipId: m.staff, costRateMinor: 3_500n, billRateMinor: 9_500n });
  await setRate(database, owner, { membershipId: m.manager, costRateMinor: 5_000n, billRateMinor: 12_000n });
  const staffCtx = await contextFor(database, DEMO_SLUG, uid("staff@demo.test"));
  for (let i = 1; i <= 10; i++) {
    await logTime(database, staffCtx, "own", {
      projectId: i % 3 === 0 ? cafeCare : website,
      taskId: null,
      membershipId: null,
      date: addDays(today, -i * 2),
      minutes: 60 + (i % 4) * 45,
      note: i % 3 === 0 ? "Content updates" : "Build and QA",
      billable: true,
    });
  }

  const [onboarding] = await listTemplates(database, tenantId);
  if (onboarding) await sendOnboarding(database, owner, { clientId: fitness, templateId: onboarding.id });

  return result;
}
