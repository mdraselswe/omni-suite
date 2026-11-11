# 5. Authentication (Better Auth) and dynamic, permission-based access

## Decision

- **Better Auth** handles identity only: Google sign-in now; email + password ships too and is switched on with `AUTH_EMAIL_PASSWORD=true`. Users are provider-independent, so the same email links both methods.
- **Authorization is ours**, in our own tables:
  - Permission catalogue in code, declared by each module's `manifest.ts` (`key`, `audience: internal | client`, `defaultRoles`).
  - `roles` per tenant (system defaults are copied on tenant creation and stay editable; "Reset to default" restores them). Custom roles can be added.
  - `role_permissions(role, permission, scope)`, scope = `own | assigned | all`.
  - `member_roles` (a member can hold several roles).
  - `member_overrides(permission, allow|deny, scope, expires_at, reason)` for one person.
  - Effective set = union of roles + allows − denies. Deny wins. Expired overrides are ignored.
- Guards: nobody can grant a permission they do not hold; the last owner cannot lose `owner`; client roles cannot receive internal permissions; every change is audited.
- Speed: effective permissions are cached in memory per membership and keyed by `tenants.permissions_version`, which every role/override change increments.
- Platform admins are listed in `PLATFORM_ADMIN_EMAILS` (config, not data).

## Why

Library RBAC plugins don't cover per-user allow/deny with expiry and scope. Owning these tables keeps the rules explicit and testable (`src/server/rbac/*.test.ts`).
