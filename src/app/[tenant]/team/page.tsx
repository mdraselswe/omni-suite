import Link from "next/link";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionButton } from "@/components/form/action-button";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  InviteFields,
  inviteAction,
  listMembers,
  listRoles,
  pendingInvitations,
  revokeInvitationAction,
  type Member,
} from "@/features/team";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { appUrl } from "@/server/mail";
import { clientOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function TeamPage({ params }: PageProps<"/[tenant]/team">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "members.read");
  const f = formatters(ctx);
  const canInvite = hasPermission(ctx, "members.invite");
  const canManage = hasPermission(ctx, "members.manage");
  const database = db();
  const [members, roles, invitations, clients] = await Promise.all([
    listMembers(database, ctx.tenant.id),
    canInvite ? listRoles(database, ctx.tenant.id) : Promise.resolve([]),
    canInvite ? pendingInvitations(database, ctx.tenant.id) : Promise.resolve([]),
    clientOptions(database, ctx.tenant.id),
  ]);
  const clientName = new Map(clients.map((c) => [c.value, c.label]));
  const internal = members.filter((m) => m.kind === "internal");
  const portal = members.filter((m) => m.kind === "client");

  const table = (rows: Member[]) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("form.name")}</TableHead>
          <TableHead>{t("team.roles")}</TableHead>
          <TableHead className="hidden md:table-cell">{t("team.status")}</TableHead>
          {canManage ? <TableHead className="w-0" /> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((m) => (
          <TableRow key={m.id}>
            <TableCell>
              <div className="grid gap-0.5">
                <span className="font-medium">
                  {m.name}
                  {m.userId === ctx.user.id ? (
                    <span className="text-muted-foreground"> ({t("team.you")})</span>
                  ) : null}
                </span>
                <span className="text-xs break-all text-muted-foreground">{m.email}</span>
                {m.title ? <span className="text-xs text-muted-foreground">{m.title}</span> : null}
                {m.clientId ? (
                  <span className="text-xs text-muted-foreground">{clientName.get(m.clientId) ?? ""}</span>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {m.roles.length === 0 ? (
                  <span className="text-xs text-muted-foreground">{t("team.noRoles")}</span>
                ) : null}
                {m.roles.map((r) => (
                  <Badge key={r.roleId} variant={r.key === "owner" ? "default" : "secondary"}>
                    {r.name}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell className="hidden md:table-cell">
              <StatusBadge
                status={m.status}
                label={m.status === "active" ? t("team.statusActive") : t("team.statusDisabled")}
              />
            </TableCell>
            {canManage ? (
              <TableCell>
                <Link
                  href={tenantHref(tenant, `team/${m.id}`)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {t("team.viewDetails")}
                </Link>
              </TableCell>
            ) : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div className="grid gap-8">
      <Section
        title={t("team.members")}
        actions={
          canInvite ? (
            <FormDialog
              trigger={t("team.invite")}
              title={t("team.invite")}
              action={inviteAction.bind(null, tenant)}
              submitLabel={t("team.invite")}
            >
              <InviteFields
                roles={roles.map((r) => ({
                  id: r.id,
                  name: r.name,
                  audience: r.audience,
                  description: r.description,
                }))}
                clients={clients}
              />
            </FormDialog>
          ) : null
        }
      >
        {internal.length === 0 ? <EmptyState title={t("team.noAccess")} /> : table(internal)}
      </Section>

      <Section title={t("team.clients")}>
        {portal.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("clients.noPortalUsers")}</p>
        ) : (
          table(portal)
        )}
      </Section>

      {canInvite ? (
        <Section title={t("team.invitations")}>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("team.noInvitations")}</p>
          ) : (
            <ul className="grid gap-2">
              {invitations.map((inv) => {
                const link = appUrl(`/invite/${inv.token}`);
                return (
                  <li key={inv.id} className="grid gap-2 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-medium break-all">{inv.email}</span>
                        <Badge variant="outline">{t(`team.kind.${inv.kind}`)}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {t("team.expiresOn", { date: f.date(inv.expiresAt.toISOString().slice(0, 10)) })}
                        </span>
                      </div>
                      <ActionButton
                        action={revokeInvitationAction.bind(null, tenant)}
                        values={{ id: inv.id }}
                        confirm={t("form.confirm")}
                        variant="ghost"
                      >
                        {t("team.revoke")}
                      </ActionButton>
                    </div>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                      {t("team.inviteLink")}
                      <Input readOnly value={link} className="font-mono text-xs" />
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ) : null}
    </div>
  );
}
