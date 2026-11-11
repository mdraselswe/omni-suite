import type { Scope } from "@/server/rbac/resolve";
import type { MessageKey } from "@/i18n";

/**
 * The module registry (ADR 0009). Every permission and navigation entry in the
 * app is declared here, so roles, menus and module switches come from one list.
 * Adding a module: add an entry, add its i18n keys, build its folder in src/features.
 */

export const DEFAULT_ROLE_KEYS = [
  "owner",
  "admin",
  "manager",
  "staff",
  "accountant",
  "client_owner",
  "client_member",
] as const;
export type DefaultRoleKey = (typeof DEFAULT_ROLE_KEYS)[number];

export type Audience = "internal" | "client";

export type PermissionDef = {
  key: string;
  label: MessageKey;
  audience: Audience;
  /** Scopes this permission understands. Single "all" means no row-level scoping. */
  scopes: readonly Scope[];
  defaultRoles: Partial<Record<DefaultRoleKey, Scope>>;
};

export type IconName =
  | "dashboard"
  | "wallet"
  | "users"
  | "handshake"
  | "contact"
  | "target"
  | "file-text"
  | "receipt"
  | "folder"
  | "clock"
  | "paperclip"
  | "settings"
  | "shield"
  | "history"
  | "cloud"
  | "globe"
  | "clipboard";

export type NavItem = {
  /** Path below the tenant base, e.g. "finance" → /<tenant>/finance. "" is the home. */
  path: string;
  label: MessageKey;
  icon: IconName;
  /** Shown when the member holds this permission (any scope). */
  permission: string;
  area: "team" | "portal";
};

export type ModuleDef = {
  key: string;
  label: MessageKey;
  /** Tenants may switch it off in Settings. */
  optional: boolean;
  permissions: readonly PermissionDef[];
  nav: readonly NavItem[];
};

const ALL: readonly Scope[] = ["all"];
const ROWS: readonly Scope[] = ["own", "assigned", "all"];

const internal = (
  key: string,
  label: MessageKey,
  defaultRoles: PermissionDef["defaultRoles"],
  scopes: readonly Scope[] = ALL,
): PermissionDef => ({ key, label, audience: "internal", scopes, defaultRoles });

const client = (
  key: string,
  label: MessageKey,
  defaultRoles: PermissionDef["defaultRoles"],
): PermissionDef => ({
  key,
  label,
  audience: "client",
  scopes: ALL,
  defaultRoles,
});

const owners = { owner: "all", admin: "all" } as const;

export const MODULES: readonly ModuleDef[] = [
  {
    key: "dashboard",
    label: "module.dashboard",
    optional: false,
    permissions: [
      internal("dashboard.read", "perm.dashboard.read", {
        ...owners,
        manager: "all",
        accountant: "all",
      }),
    ],
    nav: [
      { path: "", label: "nav.dashboard", icon: "dashboard", permission: "dashboard.read", area: "team" },
    ],
  },
  {
    key: "finance",
    label: "module.finance",
    optional: false,
    permissions: [
      internal("finance.read", "perm.finance.read", { ...owners, accountant: "all" }),
      internal("finance.write", "perm.finance.write", { ...owners }),
      internal("finance.close", "perm.finance.close", { owner: "all" }),
      internal("finance.export", "perm.finance.export", { ...owners, accountant: "all" }),
    ],
    nav: [
      { path: "finance", label: "nav.finance", icon: "wallet", permission: "finance.read", area: "team" },
    ],
  },
  {
    key: "partners",
    label: "module.partners",
    optional: false,
    permissions: [
      internal("partners.read", "perm.partners.read", { owner: "all", accountant: "all" }),
      internal("partners.manage", "perm.partners.manage", { owner: "all" }),
      internal("profit.propose", "perm.profit.propose", { owner: "all" }),
      internal("distributions.run", "perm.distributions.run", { owner: "all" }),
    ],
    nav: [
      {
        path: "partners",
        label: "nav.partners",
        icon: "handshake",
        permission: "partners.read",
        area: "team",
      },
    ],
  },
  {
    key: "crm",
    label: "module.crm",
    optional: true,
    permissions: [
      internal("leads.read", "perm.leads.read", { ...owners, manager: "all" }, ROWS),
      internal("leads.write", "perm.leads.write", { ...owners, manager: "all" }, ROWS),
    ],
    nav: [{ path: "leads", label: "nav.leads", icon: "target", permission: "leads.read", area: "team" }],
  },
  {
    key: "clients",
    label: "module.clients",
    optional: false,
    permissions: [
      internal(
        "clients.read",
        "perm.clients.read",
        { ...owners, manager: "all", accountant: "all", staff: "assigned" },
        ROWS,
      ),
      internal("clients.write", "perm.clients.write", { ...owners, manager: "all" }),
      internal("onboarding.manage", "perm.onboarding.manage", { ...owners, manager: "all" }),
    ],
    nav: [
      { path: "clients", label: "nav.clients", icon: "contact", permission: "clients.read", area: "team" },
    ],
  },
  {
    key: "proposals",
    label: "module.proposals",
    optional: true,
    permissions: [
      internal("proposals.read", "perm.proposals.read", { ...owners, manager: "all", accountant: "all" }),
      internal("proposals.write", "perm.proposals.write", { ...owners, manager: "all" }),
    ],
    nav: [
      {
        path: "proposals",
        label: "nav.proposals",
        icon: "file-text",
        permission: "proposals.read",
        area: "team",
      },
    ],
  },
  {
    key: "invoices",
    label: "module.invoices",
    optional: false,
    permissions: [
      internal("invoices.read", "perm.invoices.read", { ...owners, manager: "all", accountant: "all" }),
      internal("invoices.write", "perm.invoices.write", { ...owners, manager: "all" }),
      internal("payments.record", "perm.payments.record", { ...owners, accountant: "all" }),
    ],
    nav: [
      { path: "invoices", label: "nav.invoices", icon: "receipt", permission: "invoices.read", area: "team" },
    ],
  },
  {
    key: "projects",
    label: "module.projects",
    optional: true,
    permissions: [
      internal("projects.read", "perm.projects.read", { ...owners, manager: "all", staff: "assigned" }, ROWS),
      internal("projects.write", "perm.projects.write", { ...owners, manager: "all" }),
      internal("tasks.write", "perm.tasks.write", { ...owners, manager: "all", staff: "assigned" }, ROWS),
      internal(
        "time.read",
        "perm.time.read",
        { ...owners, manager: "all", accountant: "all", staff: "own" },
        ROWS,
      ),
      internal("time.write", "perm.time.write", { ...owners, manager: "all", staff: "own" }, ROWS),
    ],
    nav: [
      { path: "projects", label: "nav.projects", icon: "folder", permission: "projects.read", area: "team" },
      { path: "time", label: "nav.time", icon: "clock", permission: "time.read", area: "team" },
    ],
  },
  {
    key: "files",
    label: "module.files",
    optional: true,
    permissions: [
      internal(
        "files.read",
        "perm.files.read",
        { ...owners, manager: "all", staff: "assigned", accountant: "all" },
        ROWS,
      ),
      internal("files.write", "perm.files.write", { ...owners, manager: "all", staff: "assigned" }, ROWS),
    ],
    nav: [{ path: "files", label: "nav.files", icon: "paperclip", permission: "files.read", area: "team" }],
  },
  {
    key: "team",
    label: "module.team",
    optional: false,
    permissions: [
      internal("members.read", "perm.members.read", { ...owners, manager: "all" }),
      internal("members.invite", "perm.members.invite", { ...owners }),
      internal("members.manage", "perm.members.manage", { ...owners }),
      internal("roles.manage", "perm.roles.manage", { owner: "all" }),
    ],
    nav: [{ path: "team", label: "nav.team", icon: "users", permission: "members.read", area: "team" }],
  },
  {
    key: "settings",
    label: "module.settings",
    optional: false,
    permissions: [
      internal("settings.manage", "perm.settings.manage", { owner: "all", admin: "all" }),
      internal("audit.read", "perm.audit.read", { owner: "all", admin: "all", accountant: "all" }),
      internal("backup.manage", "perm.backup.manage", { owner: "all" }),
      internal("domains.manage", "perm.domains.manage", { owner: "all" }),
    ],
    nav: [
      { path: "audit", label: "nav.audit", icon: "history", permission: "audit.read", area: "team" },
      {
        path: "settings",
        label: "nav.settings",
        icon: "settings",
        permission: "settings.manage",
        area: "team",
      },
    ],
  },
  {
    key: "portal",
    label: "module.portal",
    optional: false,
    permissions: [
      client("portal.access", "perm.portal.access", { client_owner: "all", client_member: "all" }),
      client("portal.projects", "perm.portal.projects", { client_owner: "all", client_member: "all" }),
      client("portal.invoices", "perm.portal.invoices", { client_owner: "all" }),
      client("portal.files", "perm.portal.files", { client_owner: "all", client_member: "all" }),
      client("portal.approve", "perm.portal.approve", { client_owner: "all" }),
      client("portal.proposals", "perm.portal.proposals", { client_owner: "all" }),
      client("portal.onboarding", "perm.portal.onboarding", { client_owner: "all" }),
    ],
    nav: [
      {
        path: "portal",
        label: "nav.portal.home",
        icon: "dashboard",
        permission: "portal.access",
        area: "portal",
      },
      {
        path: "portal/projects",
        label: "nav.portal.projects",
        icon: "folder",
        permission: "portal.projects",
        area: "portal",
      },
      {
        path: "portal/invoices",
        label: "nav.portal.invoices",
        icon: "receipt",
        permission: "portal.invoices",
        area: "portal",
      },
      {
        path: "portal/proposals",
        label: "nav.portal.proposals",
        icon: "file-text",
        permission: "portal.proposals",
        area: "portal",
      },
      {
        path: "portal/files",
        label: "nav.portal.files",
        icon: "paperclip",
        permission: "portal.files",
        area: "portal",
      },
      {
        path: "portal/onboarding",
        label: "nav.portal.onboarding",
        icon: "clipboard",
        permission: "portal.onboarding",
        area: "portal",
      },
    ],
  },
];

export const PERMISSIONS: readonly PermissionDef[] = MODULES.flatMap((m) => m.permissions);
const byKey = new Map(PERMISSIONS.map((p) => [p.key, p]));

export function permissionDef(key: string): PermissionDef | undefined {
  return byKey.get(key);
}

export function moduleOfPermission(key: string): ModuleDef | undefined {
  return MODULES.find((m) => m.permissions.some((p) => p.key === key));
}

/** Every permission granted to the owner role: everything internal. */
export const OWNER_PERMISSIONS = PERMISSIONS.filter((p) => p.audience === "internal");

export type DefaultRoleTemplate = {
  key: DefaultRoleKey;
  name: MessageKey;
  description: MessageKey;
  audience: Audience;
  grants: { permission: string; scope: Scope }[];
};

const ROLE_META: Record<DefaultRoleKey, { audience: Audience; name: MessageKey; description: MessageKey }> = {
  owner: { audience: "internal", name: "role.owner", description: "role.owner.desc" },
  admin: { audience: "internal", name: "role.admin", description: "role.admin.desc" },
  manager: { audience: "internal", name: "role.manager", description: "role.manager.desc" },
  staff: { audience: "internal", name: "role.staff", description: "role.staff.desc" },
  accountant: { audience: "internal", name: "role.accountant", description: "role.accountant.desc" },
  client_owner: { audience: "client", name: "role.client_owner", description: "role.client_owner.desc" },
  client_member: { audience: "client", name: "role.client_member", description: "role.client_member.desc" },
};

/** Default role templates, built from the permission declarations. Owner gets every internal permission. */
export function defaultRoleTemplates(): DefaultRoleTemplate[] {
  return DEFAULT_ROLE_KEYS.map((key) => {
    const meta = ROLE_META[key];
    const grants =
      key === "owner"
        ? OWNER_PERMISSIONS.map((p) => ({ permission: p.key, scope: "all" as Scope }))
        : PERMISSIONS.flatMap((p) => {
            const scope = p.defaultRoles[key];
            return scope ? [{ permission: p.key, scope }] : [];
          });
    return { key, ...meta, grants };
  });
}
