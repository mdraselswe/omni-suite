import { describe, expect, it } from "vitest";
import { can, canGrant, resolvePermissions } from "./resolve";

const now = new Date("2026-11-11T00:00:00Z");

describe("resolvePermissions", () => {
  it("unions role grants with the widest scope", () => {
    const perms = resolvePermissions({
      roleGrants: [
        { permission: "projects.read", scope: "assigned" },
        { permission: "projects.read", scope: "all" },
        { permission: "time.write", scope: "own" },
      ],
      overrides: [],
      now,
    });
    expect(perms.get("projects.read")).toBe("all");
    expect(perms.get("time.write")).toBe("own");
  });

  it("adds allow overrides and lets deny win", () => {
    const perms = resolvePermissions({
      roleGrants: [{ permission: "finance.read", scope: "all" }],
      overrides: [
        { permission: "invoices.read", effect: "allow", scope: "all", expiresAt: null },
        { permission: "finance.read", effect: "deny", scope: "all", expiresAt: null },
        { permission: "invoices.read", effect: "allow", scope: "all", expiresAt: null },
      ],
      now,
    });
    expect(can(perms, "invoices.read", "all")).toBe(true);
    expect(can(perms, "finance.read")).toBe(false);
  });

  it("ignores expired overrides", () => {
    const perms = resolvePermissions({
      roleGrants: [],
      overrides: [
        {
          permission: "invoices.read",
          effect: "allow",
          scope: "all",
          expiresAt: new Date("2026-11-10T00:00:00Z"),
        },
      ],
      now,
    });
    expect(can(perms, "invoices.read")).toBe(false);
  });

  it("checks scope coverage", () => {
    const perms = resolvePermissions({
      roleGrants: [{ permission: "projects.read", scope: "assigned" }],
      overrides: [],
      now,
    });
    expect(can(perms, "projects.read", "own")).toBe(true);
    expect(can(perms, "projects.read", "assigned")).toBe(true);
    expect(can(perms, "projects.read", "all")).toBe(false);
  });

  it("blocks granting more than you hold", () => {
    const granter = resolvePermissions({
      roleGrants: [{ permission: "clients.read", scope: "assigned" }],
      overrides: [],
      now,
    });
    expect(canGrant(granter, "clients.read", "assigned")).toBe(true);
    expect(canGrant(granter, "clients.read", "all")).toBe(false);
    expect(canGrant(granter, "partners.manage", "all")).toBe(false);
  });
});
