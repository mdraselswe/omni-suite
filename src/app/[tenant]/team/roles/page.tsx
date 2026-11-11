import { ActionButton } from "@/components/form/action-button";
import { SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createRoleAction,
  deleteRoleAction,
  listRoles,
  resetRoleAction,
  updateRoleAction,
  type RoleWithGrants,
} from "@/features/team";
import { t } from "@/i18n";
import { DEFAULT_ROLE_KEYS, MODULES, type Audience } from "@/modules/catalog";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";

const control =
  "h-8 w-full rounded-md border border-input bg-card px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

function modulesFor(audience: Audience) {
  return MODULES.map((m) => ({
    ...m,
    permissions: m.permissions.filter((p) => p.audience === audience),
  })).filter((m) => m.permissions.length > 0);
}

/** Edit form body: one scope select per permission of the role's audience. */
function GrantSelects({ role }: { role: RoleWithGrants }) {
  const scopeOf = new Map(role.grants.map((g) => [g.permission, g.scope]));
  return (
    <div className="grid gap-5">
      {modulesFor(role.audience).map((m) => (
        <fieldset key={m.key} className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold">{t(m.label)}</legend>
          {m.permissions.map((p) => (
            <div key={p.key} className="grid items-center gap-1 sm:grid-cols-[1fr_9rem] sm:gap-3">
              <Label htmlFor={`g_${role.id}_${p.key}`} className="font-normal">
                {t(p.label)}
              </Label>
              <select
                id={`g_${role.id}_${p.key}`}
                name={`g_${p.key}`}
                defaultValue={scopeOf.get(p.key) ?? ""}
                className={control}
              >
                <option value="">{t("form.none")}</option>
                {p.scopes.map((s) => (
                  <option key={s} value={s}>
                    {t(`scope.${s}`)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
      ))}
    </div>
  );
}

export default async function RolesPage({ params }: PageProps<"/[tenant]/team/roles">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "roles.manage");
  const roles = await listRoles(db(), ctx.tenant.id);
  const isDefault = (key: string) => (DEFAULT_ROLE_KEYS as readonly string[]).includes(key);
  const audiences: Audience[] = ["internal", "client"];

  return (
    <div className="grid gap-8">
      <Section
        title={t("team.rolesTitle")}
        description={t("team.rolesSub")}
        actions={
          <FormDialog
            trigger={t("team.newRole")}
            title={t("team.newRole")}
            action={createRoleAction.bind(null, tenant)}
          >
            <TextField name="name" label={t("form.name")} required />
            <TextField name="description" label={t("form.description")} />
            <SelectField
              name="audience"
              label={t("team.audience")}
              options={audiences.map((a) => ({ value: a, label: t(`team.kind.${a}`) }))}
            />
            <SelectField
              name="copyFromRoleId"
              label={t("team.copyFrom")}
              options={roles.map((r) => ({
                value: r.id,
                label: `${r.name} (${t(`team.kind.${r.audience}`)})`,
              }))}
              placeholder={t("form.none")}
            />
          </FormDialog>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {roles.map((role) => (
            <div key={role.id} className="grid content-start gap-3 surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{role.name}</h3>
                <Badge variant="outline">{t(`team.kind.${role.audience}`)}</Badge>
                {isDefault(role.key) ? <Badge variant="secondary">{t("team.system")}</Badge> : null}
              </div>
              {role.description ? <p className="text-sm text-muted-foreground">{role.description}</p> : null}
              <p className="text-xs text-muted-foreground">
                {t("team.membersCount", { count: role.memberCount })} ·{" "}
                {role.key === "owner"
                  ? t("team.ownerAll")
                  : t("team.permissionCount", { count: role.grants.length })}
              </p>
              {role.key === "owner" ? (
                <p className="text-xs text-muted-foreground">{t("team.ownerFixed")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <FormDialog
                    trigger={t("team.editRole")}
                    title={role.name}
                    action={updateRoleAction.bind(null, tenant)}
                    variant="outline"
                    size="sm"
                    icon={false}
                    wide
                  >
                    <input type="hidden" name="roleId" value={role.id} />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <TextField name="name" label={t("form.name")} defaultValue={role.name} required />
                      <TextField
                        name="description"
                        label={t("form.description")}
                        defaultValue={role.description}
                      />
                    </div>
                    <GrantSelects role={role} />
                  </FormDialog>
                  {isDefault(role.key) ? (
                    <ActionButton
                      action={resetRoleAction.bind(null, tenant)}
                      values={{ roleId: role.id }}
                      confirm={t("form.confirm")}
                      variant="ghost"
                    >
                      {t("team.reset")}
                    </ActionButton>
                  ) : (
                    <ActionButton
                      action={deleteRoleAction.bind(null, tenant)}
                      values={{ roleId: role.id }}
                      confirm={t("form.confirm")}
                      variant="ghost"
                    >
                      {t("form.delete")}
                    </ActionButton>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      {audiences.map((audience) => {
        const cols = roles.filter((r) => r.audience === audience);
        if (cols.length === 0) return null;
        const scopes = new Map(
          cols.map((r) => [r.id, new Map(r.grants.map((g) => [g.permission, g.scope]))]),
        );
        return (
          <Section
            key={audience}
            title={`${t("team.matrix")} · ${t(`team.kind.${audience}`)}`}
            description={t("team.matrixSub")}
          >
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-56">{t("team.permission")}</TableHead>
                    {cols.map((r) => (
                      <TableHead key={r.id} className="text-center whitespace-nowrap">
                        {r.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {modulesFor(audience).flatMap((m) =>
                    m.permissions.map((p) => (
                      <TableRow key={p.key}>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">{t(m.label)} · </span>
                          {t(p.label)}
                        </TableCell>
                        {cols.map((r) => {
                          const s = scopes.get(r.id)?.get(p.key);
                          return (
                            <TableCell key={r.id} className="text-center text-xs">
                              {s ? t(`scope.${s}`) : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    )),
                  )}
                </TableBody>
              </Table>
            </div>
          </Section>
        );
      })}
    </div>
  );
}
