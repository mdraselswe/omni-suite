import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from "@/features/auth";
import { createClient, listTemplates, sendOnboarding, submitOnboarding } from "@/features/clients";
import { convertLead, createLead, setLeadArchived } from "@/features/crm";
import {
  closePeriod,
  createAccount,
  createTransaction,
  listCategories,
  reverseTransaction,
} from "@/features/finance";
import { createBill, payBill } from "@/features/bills";
import {
  createInvoice,
  createRecurring,
  issueCreditNote,
  recordPayment,
  sendInvoice,
  voidInvoice,
} from "@/features/invoices";
import {
  createPartner,
  decideRule,
  proposeRule,
  recordCapital,
  saveDistribution,
  setInitialOwnership,
} from "@/features/partners";
import {
  addComment,
  createProject,
  createTask,
  invoiceUnbilledTime,
  listProjectTemplates,
  listTasks,
  logTime,
  setProjectMember,
  setRate,
  updateTask,
} from "@/features/projects";
import { createProposal, invoiceFromProposal, respondToProposal, sendProposal } from "@/features/proposals";
import { shareLinkFor } from "@/features/sharing";
import { addDays, addMonths, monthEnd, monthStart, today as todayIn } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import type { LineItem } from "@/lib/line-items";
import type { Database, DbOrTx } from "@/server/db";
import {
  account,
  accounts,
  bills,
  clients,
  invoices,
  memberRoles,
  memberships,
  proposals,
  roles,
  tenants,
  user,
} from "@/server/db/schema";
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

/**
 * Samples added in a later version: a credit note, a share link and supplier
 * bills. Also added (once) to a demo business that an older seed made, so
 * `pnpm db:seed` shows the new features without wiping anything.
 */
async function addLaterSamples(database: Database, today: string): Promise<boolean> {
  const [demo] = await database.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, DEMO_SLUG));
  if (!demo) return false;
  const [hasBill] = await database
    .select({ id: bills.id })
    .from(bills)
    .where(eq(bills.tenantId, demo.id))
    .limit(1);
  if (hasBill) return false;
  const [ownerUser] = await database
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, "owner@demo.test"));
  if (!ownerUser) return false;
  const owner = await contextFor(database, DEMO_SLUG, ownerUser.id);
  const [bank] = await database
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.tenantId, demo.id), eq(accounts.name, "Business bank")));
  if (!bank) return false;
  const cats = await listCategories(database, demo.id);
  const cat = (name: string) => cats.find((c) => c.name === name)?.id ?? null;
  const invoiceOf = async (client: string, status: "partially_paid" | "sent") => {
    const [row] = await database
      .select({ id: invoices.id })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(eq(invoices.tenantId, demo.id), eq(clients.name, client), eq(invoices.status, status)))
      .orderBy(asc(invoices.dueDate))
      .limit(1);
    return row?.id ?? null;
  };

  // One suburb page was dropped from the SEO work: a credit note takes $300 off what is owed.
  const plumbingInvoice = await invoiceOf("Coastal Plumbing", "partially_paid");
  if (plumbingInvoice) {
    await issueCreditNote(database, owner, plumbingInvoice, {
      amountMinor: 30_000n,
      date: addDays(today, -2),
      reason: "Local SEO: one suburb page dropped from the scope, as agreed by phone.",
    });
  }
  // The share link of the cafe's late invoice, as staff would copy it into a message.
  const cafeLate = await invoiceOf("Harbour Cafe", "sent");
  if (cafeLate) await shareLinkFor(database, owner, "invoice", cafeLate);

  /* Supplier bills (what the business owes): hosting paid, the designer half paid, the accountant overdue. */
  const hosting = await createBill(database, owner, {
    supplier: "CloudHost Pty Ltd",
    reference: "CH-20931",
    issueDate: addDays(today, -25),
    dueDate: addDays(today, -11),
    currency: "AUD",
    totalMinor: 39_600n,
    taxMinor: 3_600n,
    categoryId: cat("Software & tools"),
    notes: "Hosting for client websites, yearly plan",
  });
  await payBill(database, owner, hosting, {
    amountMinor: 39_600n,
    date: addDays(today, -12),
    accountId: bank.id,
  });
  const contractor = await createBill(database, owner, {
    supplier: "Pixel & Co Design",
    reference: "INV-0457",
    issueDate: addDays(today, -10),
    dueDate: addDays(today, 20),
    currency: "AUD",
    totalMinor: 220_000n,
    taxMinor: 20_000n,
    categoryId: cat("Contractors"),
    notes: "Illustrations for the Coastal Plumbing website",
  });
  await payBill(database, owner, contractor, {
    amountMinor: 110_000n,
    date: addDays(today, -5),
    accountId: bank.id,
  });
  await createBill(database, owner, {
    supplier: "Harbour Accounting",
    reference: "HA-1189",
    issueDate: addDays(today, -30),
    dueDate: addDays(today, -9),
    currency: "AUD",
    totalMinor: 77_000n,
    taxMinor: 7_000n,
    categoryId: cat("Office"),
    notes: "BAS lodgement for last quarter",
  });
  return true;
}

export type SeedResult = { demo: "created" | "updated" | "exists"; home: "created" | "exists" | "skipped" };

export async function seed(
  database: Database,
  options: { adminEmails: readonly string[]; timezone?: string },
): Promise<SeedResult> {
  const result: SeedResult = { demo: "exists", home: "skipped" };
  const tz = options.timezone ?? "Australia/Sydney";
  const today = todayIn(tz);

  /*
   * Demo sign-ins only while the demo business is being created (never re-created
   * later with the known password), and before the admins: an admin email that is
   * also a demo sign-in (owner@demo.test) keeps its demo name and password.
   */
  const demoExists = await tenantExists(database, DEMO_SLUG);
  const ids: Record<string, string> = {};
  if (!demoExists) {
    for (const a of DEMO_ACCOUNTS) ids[a.email] = await ensureUser(database, a.email, a.name, DEMO_PASSWORD);
  }

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

  if (demoExists) {
    if (await addLaterSamples(database, today)) result.demo = "updated";
    return result;
  }
  result.demo = "created";
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
    // A platform admin who is also a demo sign-in (e.g. owner@demo.test) is already a member.
    admins: await Promise.all(
      adminIds
        .filter((id) => !Object.values(ids).includes(id))
        .map((id) => addMembership(tx, tenantId, id, "owner", { title: "Platform owner" })),
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

  /*
   * Where the money lives: the AUD business bank, a BDT account for the Dhaka team
   * (salaries and rent are paid in taka) and a USD card for overseas software.
   */
  const dhaka = await createAccount(database, owner, {
    name: "Dhaka office (BDT)",
    type: "bank",
    currency: "BDT",
    openingBalanceMinor: 0n,
  });
  const usdCard = await createAccount(database, owner, {
    name: "Company card (USD)",
    type: "card",
    currency: "USD",
    openingBalanceMinor: 0n,
  });
  /** Sample rates: AUD per one unit of the other currency. */
  const AUD_PER_BDT = "0.0128";
  const AUD_PER_USD = "1.52";
  /** GST inside a GST-inclusive Australian price (1/11th), in cents. */
  const gstOf = (dollars: number) => BigInt(Math.round((dollars * 100) / 11));

  /* Monthly running costs for the last 8 months. */
  for (let k = 7; k >= 0; k--) {
    const day = addDays(monthStart(addMonths(today, -k)), 2);
    if (day > today) continue;
    // Australian costs: [category, description, dollars incl. GST, has GST]
    const spend: [string, string, number, boolean][] = [
      ["Software & tools", "Hosting, design and email tools", 189, true],
      ["Advertising", "Google & Meta ads", k % 2 === 0 ? 650 : 420, true],
      ["Contractors", "Freelance copywriter (not registered for GST)", k % 3 === 0 ? 900 : 0, false],
      ["Bank fees", "Monthly account fee", 10, false],
    ];
    for (const [category, description, dollars, gst] of spend) {
      if (dollars === 0) continue;
      await createTransaction(database, owner, {
        kind: "expense",
        accountId: bank,
        categoryId: cat(category),
        date: day,
        description,
        amountMinor: BigInt(dollars * 100),
        taxMinor: gst ? gstOf(dollars) : 0n,
      });
    }
    // Send taka to Dhaka, then pay the team and the office rent from there.
    if (addDays(day, 25) <= today) {
      await createTransaction(database, owner, {
        kind: "transfer",
        accountId: bank,
        toAccountId: dhaka,
        date: addDays(day, 20),
        description: "Monthly transfer to Dhaka (Wise)",
        amountMinor: 120_000n,
        toAmountMinor: 9_250_000n,
      });
      await createTransaction(database, owner, {
        kind: "expense",
        accountId: dhaka,
        categoryId: cat("Salaries"),
        date: addDays(day, 25),
        description: "Salaries: 2 developers, 1 designer",
        amountMinor: 7_500_000n,
        fxRate: AUD_PER_BDT,
      });
      await createTransaction(database, owner, {
        kind: "expense",
        accountId: dhaka,
        categoryId: cat("Rent"),
        date: addDays(day, 25),
        description: "Office rent, Dhanmondi",
        amountMinor: 1_500_000n,
        fxRate: AUD_PER_BDT,
      });
    }
    // Overseas software on the USD card (no GST), paid off from the bank the next month.
    if (addDays(day, 5) <= today) {
      await createTransaction(database, owner, {
        kind: "expense",
        accountId: usdCard,
        categoryId: cat("Software & tools"),
        date: addDays(day, 5),
        description: "Figma and GitHub (USD)",
        amountMinor: 6_500n,
        fxRate: AUD_PER_USD,
      });
    }
    if (addDays(day, 26) <= today) {
      await createTransaction(database, owner, {
        kind: "transfer",
        accountId: bank,
        toAccountId: usdCard,
        date: addDays(day, 26),
        description: "Pay off the USD card",
        amountMinor: 9_900n,
        toAmountMinor: 6_500n,
      });
    }
  }

  /* A mistake fixed the right way: entered twice, then reversed (the ledger keeps both rows). */
  const twice = await createTransaction(database, owner, {
    kind: "expense",
    accountId: bank,
    categoryId: cat("Bank fees"),
    date: addDays(today, -12),
    description: "Monthly account fee (entered twice)",
    amountMinor: 1_000n,
  });
  await reverseTransaction(database, owner, twice, addDays(today, -11), "Entered twice by mistake");

  /* Clients (sample businesses; .example addresses never receive mail). */
  const clientInput = (c: {
    name: string;
    contactName: string;
    email: string;
    billingEmail?: string;
    phone: string;
    website: string;
    address: string;
    notes: string;
  }) => ({ billingEmail: "", status: "active" as const, custom: {}, ...c });
  const cafe = await createClient(
    database,
    owner,
    clientInput({
      name: "Harbour Cafe",
      contactName: "Jack Wilson",
      email: "jack@harbourcafe.example",
      billingEmail: "accounts@harbourcafe.example",
      phone: "02 9000 1001",
      website: "https://harbourcafe.example",
      address: "1 Wharf St, Sydney NSW 2000",
      notes: "Care plan client since autumn. Uses the portal: approvals, files and invoices.",
    }),
  );
  const plumbing = await createClient(
    database,
    owner,
    clientInput({
      name: "Coastal Plumbing",
      contactName: "Sam Nguyen",
      email: "sam@coastalplumbing.example",
      phone: "0412 000 202",
      website: "https://coastalplumbing.example",
      address: "Wollongong NSW 2500",
      notes: "New website project from the accepted proposal (50% deposit paid).",
    }),
  );
  const fitness = await createClient(
    database,
    owner,
    clientInput({
      name: "Bondi Fitness Studio",
      contactName: "Jordan Lee",
      email: "jordan@bondifit.example",
      billingEmail: "billing@bondifit.example",
      phone: "0413 000 303",
      website: "https://bondifit.example",
      address: "Bondi NSW 2026",
      notes: "Social media retainer, plus hourly ad campaign work.",
    }),
  );
  const dental = await createClient(
    database,
    owner,
    clientInput({
      name: "Koala Dental",
      contactName: "Dr Priya Shah",
      email: "priya@koaladental.example",
      phone: "02 9000 4004",
      website: "",
      address: "Parramatta NSW 2150",
      notes: "Prospect: booking website proposal is out.",
    }),
  );
  // The cafe owner sees everything in the portal; their team member sees work and files, not money.
  await database.transaction(async (tx) => {
    await addMembership(tx, tenantId, uid("client@demo.test"), "client_owner", {
      kind: "client",
      clientId: cafe,
    });
    await addMembership(tx, tenantId, uid("clientstaff@demo.test"), "client_member", {
      kind: "client",
      clientId: cafe,
    });
  });

  /* Leads: real-looking sources, owners and follow-ups; one won and converted, one lost, one archived. */
  const leadRows: {
    name: string;
    company: string;
    stage: string;
    dollars: number;
    source: string;
    owner: string | null;
    followUp: number | null;
    notes: string;
  }[] = [
    {
      name: "Ava Chen",
      company: "Sunrise Bakery",
      stage: "new",
      dollars: 2500,
      source: "Website form",
      owner: m.manager,
      followUp: 0,
      notes: "Wants online orders before Christmas.",
    },
    {
      name: "Liam Brown",
      company: "Brown Electrical",
      stage: "call",
      dollars: 4000,
      source: "Referral (Coastal Plumbing)",
      owner: m.manager,
      followUp: -2,
      notes: "Call booked; send examples of trade sites first.",
    },
    {
      name: "Olivia Smith",
      company: "Smith Legal",
      stage: "proposal",
      dollars: 8500,
      source: "Google Ads",
      owner: owner.membership.id,
      followUp: 3,
      notes: "Proposal sent; decision after their partners' meeting.",
    },
    {
      name: "Noah Taylor",
      company: "Taylor Physio",
      stage: "pilot",
      dollars: 3000,
      source: "Networking event",
      owner: m.manager,
      followUp: 7,
      notes: "Free 30-day pilot running (Google Business Profile).",
    },
    {
      name: "Grace Kim",
      company: "Kim's Kitchen",
      stage: "new",
      dollars: 1500,
      source: "Facebook",
      owner: m.staff,
      followUp: null,
      notes: "",
    },
    {
      name: "Ethan Wright",
      company: "Wright Builders",
      stage: "lost",
      dollars: 6000,
      source: "Website form",
      owner: m.manager,
      followUp: null,
      notes: "Went with a cheaper quote.",
    },
    {
      name: "Emma Davis",
      company: "Davis Florist",
      stage: "won",
      dollars: 1800,
      source: "Referral (Harbour Cafe)",
      owner: owner.membership.id,
      followUp: null,
      notes: "Won: starts next month.",
    },
    {
      name: "Test Enquiry",
      company: "",
      stage: "new",
      dollars: 0,
      source: "Website form",
      owner: null,
      followUp: null,
      notes: "Spam",
    },
  ];
  const leadIds: Record<string, string> = {};
  for (const l of leadRows) {
    leadIds[l.name] = await createLead(database, owner, {
      name: l.name,
      company: l.company,
      email: l.company
        ? `${l.name.split(" ")[0]?.toLowerCase() ?? "hello"}@${l.company.toLowerCase().replace(/[^a-z]/g, "")}.example`
        : "",
      phone: l.company ? "0400 000 000" : "",
      source: l.source,
      stage: l.stage,
      valueMinor: BigInt(l.dollars * 100),
      notes: l.notes,
      followUpDate: l.followUp === null ? null : addDays(today, l.followUp),
      ownerMembershipId: l.owner,
      custom: {},
    });
  }
  const wonLead = leadIds["Emma Davis"];
  if (wonLead) await convertLead(database, owner, "all", wonLead);
  const spamLead = leadIds["Test Enquiry"];
  if (spamLead) await setLeadArchived(database, owner, "all", spamLead, true);

  /* Monthly retainers, all paid: the cafe since month 5, the gym's social media since month 7. */
  const retainers: [string, string, number, number][] = [
    [cafe, "Website care & SEO retainer", 1500, 5],
    [fitness, "Social media management", 1800, 7],
  ];
  for (const [clientId, description, dollars, months] of retainers) {
    for (let k = months; k >= 1; k--) {
      const issue = monthStart(addMonths(today, -k));
      const id = await createInvoice(database, owner, {
        clientId,
        issueDate: issue,
        dueDate: addDays(issue, 14),
        items: [item(description, "1", dollars)],
        notes: "",
        custom: {},
      });
      await sendInvoice(database, owner, id);
      await recordPayment(database, owner, id, {
        amountMinor: BigInt(dollars * 110),
        date: addDays(issue, 9),
        accountId: bank,
        method: "Bank transfer",
        categoryId: cat("Retainers"),
      });
    }
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
  await respondToProposal(database, owner, proposal, {
    accept: true,
    acceptTerms: true,
    name: "Sam Coastal",
    ip: "",
    today,
  });
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

  /*
   * Onboarding: the cafe filled in its form in the portal (the team now works the
   * checklist); the gym has no portal login yet, so the form went with an invitation.
   */
  const [onboarding] = await listTemplates(database, tenantId);
  if (onboarding) {
    const cafeForm = await sendOnboarding(database, owner, { clientId: cafe, templateId: onboarding.id });
    const cafeUser = await contextFor(database, DEMO_SLUG, uid("client@demo.test"));
    await submitOnboarding(database, cafeUser, cafeForm.id, {
      business: "Harbour Cafe",
      goals: "More weekday lunch orders and a menu that is easy to update ourselves.",
      audience: "Office workers near the wharf, weekend families and tourists.",
      brand: "Logo and photos are in the Files tab.",
      website: "https://harbourcafe.example",
    });
    await sendOnboarding(database, owner, {
      clientId: fitness,
      templateId: onboarding.id,
      inviteEmail: "jordan@bondifit.example",
    });
  }

  /* What the cafe sees in the portal: this month's bill, one late invoice, and proposals in every state. */
  const cafeThisMonth = await createInvoice(database, owner, {
    clientId: cafe,
    issueDate: monthStart(today),
    dueDate: addDays(monthStart(today), 14),
    items: [item("Website care & SEO retainer", "1", 1500)],
    notes: "",
    custom: {},
  });
  await sendInvoice(database, owner, cafeThisMonth);
  const cafeLate = await createInvoice(database, owner, {
    clientId: cafe,
    issueDate: addDays(today, -35),
    dueDate: addDays(today, -21),
    items: [item("Menu photography (half day)", "1", 450)],
    notes: "",
    custom: {},
  });
  await sendInvoice(database, owner, cafeLate);
  const cafeProposal = (title: string, dollars: number, validDays: number) =>
    createProposal(database, owner, {
      clientId: cafe,
      title,
      intro: "Short and simple, as discussed.",
      terms: "Payment within 14 days of the invoice.",
      items: [item(title, "1", dollars)],
      validUntil: addDays(today, validDays),
    });
  const ordering = await cafeProposal("Online ordering add-on", 1200, 14);
  await sendProposal(database, owner, ordering);
  const loyalty = await cafeProposal("Loyalty app", 5200, 30);
  await sendProposal(database, owner, loyalty);
  await respondToProposal(database, owner, loyalty, {
    accept: false,
    name: "Jack Wilson",
    ip: "",
    today,
    reason: "Too much for us this year. Maybe next spring.",
  });
  const catering = await cafeProposal("Catering page refresh", 600, 1);
  await sendProposal(database, owner, catering);
  // Left unanswered past its date: shows as Expired; staff can extend it.
  await database
    .update(proposals)
    .set({ validUntil: addDays(today, -3) })
    .where(eq(proposals.id, catering));

  /* A mistake on a draft, voided (kept for the record, never owed). */
  const duplicate = await createInvoice(database, owner, {
    clientId: dental,
    issueDate: addDays(today, -9),
    dueDate: addDays(today, 5),
    items: [item("Google Business Profile setup (duplicate)", "1", 450)],
    notes: "Raised twice by mistake",
    custom: {},
  });
  await sendInvoice(database, owner, duplicate);
  await voidInvoice(database, owner, duplicate);

  /* Hourly work: ad campaigns for the gym, half the time already invoiced. */
  const ads = await createProject(database, owner, {
    name: "Bondi Fitness ad campaigns (hourly)",
    description: "Meta and Google ads, billed by the hour.",
    clientId: fitness,
    status: "active",
    startDate: addDays(today, -30),
    dueDate: null,
    budgetMinor: 0n,
    custom: {},
    templateId: null,
  });
  await setProjectMember(database, owner, { projectId: ads, membershipId: m.staff, add: true });
  for (let i = 0; i < 8; i++) {
    await logTime(database, staffCtx, "own", {
      projectId: ads,
      taskId: null,
      membershipId: null,
      date: addDays(today, -28 + i * 3),
      minutes: 90,
      note: i % 2 ? "Campaign reporting" : "Ad creative and set-up",
      billable: true,
    });
    if (i === 3) {
      const timeInvoice = await invoiceUnbilledTime(database, owner, "all", ads, addDays(today, -16));
      await sendInvoice(database, owner, timeInvoice);
    }
  }

  /* A finished project, every task done. */
  const brand = await createProject(database, owner, {
    name: "Bondi Fitness brand refresh",
    description: "New logo, colours and social templates.",
    clientId: fitness,
    status: "done",
    startDate: addDays(today, -150),
    dueDate: addDays(today, -110),
    budgetMinor: 250_000n,
    custom: {},
    templateId: null,
  });
  for (const title of ["Mood board", "Logo options", "Social templates"]) {
    await createTask(database, owner, "all", brand, {
      title,
      description: "",
      status: "done",
      assigneeMembershipId: m.staff,
      dueDate: null,
      clientVisible: true,
      needsApproval: false,
    });
  }

  /*
   * Partners: last quarter's profit split is final, both partners took a draw, and
   * the older months are closed (their numbers can no longer change).
   */
  const quarterStart = monthStart(addMonths(today, -3));
  const quarterEnd = monthEnd(addMonths(today, -1));
  await saveDistribution(database, owner, {
    start: quarterStart,
    end: quarterEnd,
    manualLabor: {},
    final: true,
  });
  for (const [partnerId, dollars] of [
    [pA, 900],
    [pB, 600],
  ] as const) {
    await createTransaction(database, owner, {
      kind: "drawing",
      accountId: bank,
      partnerId,
      date: addDays(today, -6),
      description: "Profit draw for last quarter",
      amountMinor: BigInt(dollars * 100),
    });
  }
  await closePeriod(database, owner, { startDate: start, endDate: monthEnd(addMonths(today, -4)) });

  await addLaterSamples(database, today);

  return result;
}
