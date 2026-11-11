import { notFound } from "next/navigation";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  addOverrideAction,
  listRoles,
  memberById,
  memberOverridesList,
  OverrideFields,
  removeOverrideAction,
  setMemberRolesAction,
  updateMemberAction,
} from "@/features/team";
import { t } from "@/i18n";
import { MODULES, permissionDef } from "@/modules/catalog";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { resolvePermissions } from "@/server/rbac/resolve";

export default async function MemberPage({ params }: PageProps<"/[tenant]/team/[memberId]">) {
  const { tenant, memberId } = await params;
  const { ctx } = await requireTenantPermission(tenant, "members.manage");
  if (!/^[0-9a-f-]{36}$/.test(memberId)) notFound();
  const database = db();
  const member = await memberById(database, ctx.tenant.id, memberId);
  if (!member) notFound();
  const f = formatters(ctx);
  const [roles, overrides] = await Promise.all([
    listRoles(database, ctx.tenant.id),
    memberOverridesList(database, ctx.tenant.id, member.id),
  ]);
  const ownRoles = roles.filter((r) => r.audience === member.kind);
  const held = new Set(member.roles.map((r) => r.roleId));
  const fits = (permission: string) => permissionDef(permission)?.audience === member.kind;
  const effective = resolvePermissions({
    roleGrants: roles
      .filter((r) => held.has(r.id))
      .flatMap((r) => r.grants.filter((g) => fits(g.permission))),
    overrides: overrides.filter((o) => fits(o.permission)),
  });
  const modules = MODULES.map((m) => ({
    ...m,
    permissions: m.permissions.filter((p) => p.audience === member.kind),
  })).filter((m) => m.permissions.length > 0);
  const permissionOptions = modules.flatMap((m) =>
    m.permissions.map((p) => ({ key: p.key, label: `${t(m.label)} · ${t(p.label)}`, scopes: p.scopes })),
  );
  const isSelf = member.userId === ctx.user.id;

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-heading text-xl font-semibold">{member.name}</h2>
            <Badge variant="outline">{t(`team.kind.${member.kind}`)}</Badge>
            <StatusBadge
              status={member.status}
              label={member.status === "active" ? t("team.statusActive") : t("team.statusDisabled")}
            />
          </div>
          <p className="text-sm break-all text-muted-foreground">
            {member.email}
            {member.title ? ` · ${member.title}` : ""}
          </p>
        </div>
        <FormDialog
          trigger={t("team.editMember")}
          title={member.name}
          action={updateMemberAction.bind(null, tenant)}
          variant="outline"
          icon={false}
        >
          <input type="hidden" name="membershipId" value={member.id} />
          <TextField name="title" label={t("team.titleField")} defaultValue={member.title} />
          <SelectField
            name="status"
            label={t("team.status")}
            options={[
              { value: "active", label: t("team.statusActive") },
              { value: "disabled", label: t("team.statusDisabled") },
            ]}
            defaultValue={member.status}
            disabled={isSelf}
          />
          {isSelf ? <input type="hidden" name="status" value={member.status} /> : null}
        </FormDialog>
      </div>

      <Section title={t("team.roles")} description={t("team.rolesForKind")}>
        <ActionForm action={setMemberRolesAction.bind(null, tenant)} keepValues>
          <input type="hidden" name="membershipId" value={member.id} />
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="sr-only">{t("team.roles")}</legend>
            {ownRoles.map((r) => (
              <label key={r.id} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  name="roleIds"
                  value={r.id}
                  defaultChecked={held.has(r.id)}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span className="grid">
                  <span className="font-medium">{r.name}</span>
                  {r.description ? (
                    <span className="text-xs text-muted-foreground">{r.description}</span>
                  ) : null}
                </span>
              </label>
            ))}
          </fieldset>
          <SubmitButton className="justify-self-start" pendingLabel={t("form.saving")}>
            {t("team.saveRoles")}
          </SubmitButton>
        </ActionForm>
      </Section>

      <Section
        title={t("team.overrides")}
        description={t("team.overridesSub")}
        actions={
          <FormDialog
            trigger={t("team.addOverride")}
            title={t("team.addOverride")}
            action={addOverrideAction.bind(null, tenant)}
          >
            <input type="hidden" name="membershipId" value={member.id} />
            <OverrideFields permissions={permissionOptions} />
          </FormDialog>
        }
      >
        {overrides.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("team.noOverrides")}</p>
        ) : (
          <ul className="grid gap-2">
            {overrides.map((o) => {
              const def = permissionDef(o.permission);
              const expired = o.expiresAt !== null && o.expiresAt < new Date();
              return (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={o.effect === "deny" ? "destructive" : "default"}>
                        {t(`team.effect.${o.effect}`)}
                      </Badge>
                      <span className="text-sm font-medium">{def ? t(def.label) : o.permission}</span>
                      <Badge variant="outline">{t(`scope.${o.scope}`)}</Badge>
                      {o.expiresAt ? (
                        <span
                          className={expired ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
                        >
                          {t("team.until", { date: f.date(o.expiresAt.toISOString().slice(0, 10)) })}
                        </span>
                      ) : null}
                    </div>
                    {o.reason ? <p className="text-xs text-muted-foreground">{o.reason}</p> : null}
                  </div>
                  <ActionButton
                    action={removeOverrideAction.bind(null, tenant)}
                    values={{ id: o.id }}
                    confirm={t("form.confirm")}
                    variant="ghost"
                  >
                    {t("form.remove")}
                  </ActionButton>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title={t("team.effective")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("team.permission")}</TableHead>
              <TableHead className="text-right">{t("team.scope")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {modules.flatMap((m) =>
              m.permissions.map((p) => {
                const scope = effective.get(p.key);
                return (
                  <TableRow key={p.key} className={scope ? undefined : "text-muted-foreground"}>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">{t(m.label)} · </span>
                      {t(p.label)}
                    </TableCell>
                    <TableCell className="text-right">
                      {scope ? <Badge variant="secondary">{t(`scope.${scope}`)}</Badge> : "—"}
                    </TableCell>
                  </TableRow>
                );
              }),
            )}
          </TableBody>
        </Table>
      </Section>
    </div>
  );
}
