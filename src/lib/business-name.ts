import { parseTenantSettings } from "./tenant-settings";

/**
 * The name a business shows to clients and invitees: its branding display name,
 * or its account name when none is set. Use this everywhere a client reads it.
 */
export function businessName(tenant: {
  name: string;
  settings: { branding: { displayName: string } };
}): string {
  return tenant.settings.branding.displayName.trim() || tenant.name;
}

/** The same, for a raw tenants row whose settings are still unparsed JSON. */
export function businessNameOf(row: { name: string; settings: unknown }): string {
  return businessName({ name: row.name, settings: parseTenantSettings(row.settings) });
}
