import { describe, expect, it } from "vitest";
import { tenantSettingsSchema } from "@/lib/tenant-settings";
import { hasPermission, withModuleGates, type TenantContext } from "./context";

function portalUser(disabledModules: string[]): TenantContext {
  return {
    tenant: {
      id: "t",
      slug: "t",
      name: "T",
      status: "active",
      plan: "starter",
      settings: tenantSettingsSchema.parse({ disabledModules }),
    },
    user: { id: "u", name: "U", email: "u@example.com", image: null },
    membership: { id: "m", kind: "client", clientId: "c", title: "" },
    permissions: new Map([
      ["portal.access", "all"],
      ["portal.projects", "all"],
      ["portal.files", "all"],
      ["portal.proposals", "all"],
      ["portal.invoices", "all"],
    ] as const),
    isPlatformAdmin: false,
  };
}

describe("module switches in the client portal", () => {
  it("hides portal pages whose module is switched off", () => {
    const ctx = portalUser(["projects", "files"]);
    expect(hasPermission(ctx, "portal.projects")).toBe(false);
    expect(hasPermission(ctx, "portal.files")).toBe(false);
    expect(hasPermission(ctx, "portal.proposals")).toBe(true);
    expect(hasPermission(ctx, "portal.access")).toBe(true);

    // Menus read ctx.permissions directly: the gated context drops them there too.
    const gated = withModuleGates(ctx);
    expect([...gated.permissions.keys()].sort()).toEqual([
      "portal.access",
      "portal.invoices",
      "portal.proposals",
    ]);
  });

  it("changes nothing when every module is on", () => {
    const ctx = portalUser([]);
    expect(withModuleGates(ctx)).toBe(ctx);
    expect(hasPermission(ctx, "portal.projects")).toBe(true);
  });
});
