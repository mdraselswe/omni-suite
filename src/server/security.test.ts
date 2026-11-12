// @vitest-environment node
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/server/db";

vi.mock("@/server/mail", () => ({ sendMail: vi.fn(async () => true), appUrl: (p: string) => p }));

let database: Database;
let tenantId: string;

beforeAll(async () => {
  const { createTestDb, setupTenant } = await import("@/server/testing/db");
  database = await createTestDb();
  ({ tenantId } = await setupTenant(database, "sec"));
  await Promise.all([import("./rate-limit"), import("./shared"), import("./jobs/handlers")]);
});

describe("rate counters", () => {
  it("counts per window, never past the limit, and gives slots back", async () => {
    const { consume, consumeAll, release, used, pruneCounters, HOUR_MS } = await import("./rate-limit");
    const rule = { key: "test:a", limit: 2, windowMs: HOUR_MS };
    const now = new Date("2026-01-01T10:00:00Z");
    const results = await Promise.all([1, 2, 3].map(() => consume(database, rule, now)));
    expect(results.filter(Boolean)).toHaveLength(2);
    await release(database, rule, now);
    expect(await used(database, rule, now)).toBe(1);
    // The next window starts empty.
    expect(await consume(database, rule, new Date("2026-01-01T11:00:00Z"))).toBe(true);

    // All or nothing: a full second rule gives the first one's slot back.
    const free = { key: "test:free", limit: 5, windowMs: HOUR_MS };
    const full = { key: "test:full", limit: 0, windowMs: HOUR_MS };
    expect(await consumeAll(database, [free, full], now)).toEqual(full);
    expect(await used(database, free, now)).toBe(0);

    await pruneCounters(database, new Date("2026-01-02T00:00:00Z"));
    expect(await used(database, rule, now)).toBe(0);
  });
});

describe("mail quotas", () => {
  async function fill(key: string, windowMs: number, count: number) {
    const { rateCounters } = await import("@/server/db/schema");
    await database
      .insert(rateCounters)
      .values({
        key,
        bucket: String(Math.floor(Date.now() / windowMs)),
        count,
        expiresAt: new Date(Date.now() + windowMs),
      })
      .onConflictDoUpdate({ target: [rateCounters.key, rateCounters.bucket], set: { count } });
  }
  const mail = (to: string) => ({ to, subject: "Hi", text: "Hello" });

  it("stops a business at its hourly quota with a clear error, or skips with onLimit: skip", async () => {
    const { limits } = await import("@/config");
    const { queueMail } = await import("./shared");
    const { businessMailRules } = await import("./mail-quota");
    const { jobs } = await import("@/server/db/schema");
    expect(await queueMail(database, mail("a@example.com"), { tenantId })).toBe(true);
    const [, hour] = businessMailRules(tenantId);
    if (!hour) throw new Error("no hourly rule");
    await fill(hour.key, hour.windowMs, limits.mail.perBusinessPerHour);
    await expect(queueMail(database, mail("b@example.com"), { tenantId })).rejects.toThrow(
      /emails for this hour/,
    );
    expect(await queueMail(database, mail("c@example.com"), { tenantId, onLimit: "skip" })).toBe(false);
    const queued = await database.select().from(jobs).where(eq(jobs.tenantId, tenantId));
    expect(queued).toHaveLength(1);
  });

  it("throttles mail without a business per recipient", async () => {
    const { limits } = await import("@/config");
    const { queueMail } = await import("./shared");
    const { takeRecipientMail } = await import("./mail-quota");
    for (let i = 0; i < limits.mail.perRecipientPerHour; i++) {
      expect(await takeRecipientMail(database, "Victim@Example.com")).toBe(true);
    }
    expect(await takeRecipientMail(database, "victim@example.com")).toBe(false);
    await expect(queueMail(database, mail("victim@example.com"))).rejects.toThrow(/emails/);
    expect(await queueMail(database, mail("someone@example.com"))).toBe(true);
  });
});

describe("encryption bound to a business", () => {
  it("only decrypts with the same business id and still reads old values", async () => {
    const { decrypt, encrypt, isUnbound } = await import("./crypto");
    const sealed = encrypt("refresh-token", "tenant-a");
    expect(isUnbound(sealed)).toBe(false);
    expect(decrypt(sealed, "tenant-a")).toBe("refresh-token");
    expect(() => decrypt(sealed, "tenant-b")).toThrow();
    expect(() => decrypt(sealed)).toThrow();
    const legacy = encrypt("old-token");
    expect(isUnbound(legacy)).toBe(true);
    expect(decrypt(legacy, "tenant-a")).toBe("old-token");
  });

  it("signs values per purpose", async () => {
    const { sign, verifySigned } = await import("./crypto");
    const value = sign("oauth:xero", { a: 1 });
    expect(verifySigned("oauth:xero", value)).toMatchObject({ a: 1 });
    expect(verifySigned("oauth:google-backup", value)).toBeNull();
    expect(verifySigned("oauth:xero", `${value}x`)).toBeNull();
  });
});

describe("OAuth state", () => {
  it("works once, in the starting browser, for its own provider only", async () => {
    const { finishOAuth, startOAuth } = await import("./oauth-state");
    const payload = { tenantId, slug: "sec", userId: "user-1" };
    const { state, cookie } = await startOAuth(database, "xero", payload);
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/xero/callback" });

    expect(await finishOAuth(database, "google-backup", state, cookie.value)).toBeNull();
    expect(await finishOAuth(database, "xero", state, "another-browser-nonce")).toBeNull();
    expect(await finishOAuth(database, "xero", state, undefined)).toBeNull();
    expect(await finishOAuth(database, "xero", state, cookie.value)).toEqual(payload);
    // Single use.
    expect(await finishOAuth(database, "xero", state, cookie.value)).toBeNull();
  });
});

describe("suspended businesses", () => {
  it("get no background work", async () => {
    const { createHandlers, recurringDueTenants, tenantIsActive } = await import("./jobs/handlers");
    const { tenants } = await import("@/server/db/schema");
    const { setupTenant } = await import("@/server/testing/db");
    const { tenantId: paused } = await setupTenant(database, "paused");
    await database.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, paused));
    expect(await tenantIsActive(database, paused)).toBe(false);
    expect(await tenantIsActive(database, tenantId)).toBe(true);
    expect(await recurringDueTenants(database, new Date())).not.toContain(paused);

    const handler = createHandlers(() => database).get("invoices.recurring");
    if (!handler) throw new Error("no handler");
    const job = { id: "j", type: "invoices.recurring", tenantId: paused, payload: {} };
    // Resolves without touching the suspended business.
    await expect(handler(job as Parameters<typeof handler>[0])).resolves.toBeUndefined();
  });
});

describe("trusted origins", () => {
  it("never throws on a malformed origin", async () => {
    const { trustedCustomOrigin } = await import("./auth/auth");
    await expect(trustedCustomOrigin("not a url")).resolves.toEqual([]);
    await expect(trustedCustomOrigin(null)).resolves.toEqual([]);
    await expect(trustedCustomOrigin("http://localhost:3000")).resolves.toEqual([]);
  });
});
