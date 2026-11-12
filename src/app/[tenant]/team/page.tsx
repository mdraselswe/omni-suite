import Link from "next/link";
import { FilterBar, FilterSearch, param } from "@/components/data/filter-bar";
import { formatters } from "@/components/data/format";
import { NoResults } from "@/components/data/no-results";
import { Pagination } from "@/components/data/pagination";
import { StatusBadge } from "@/components/data/status-badge";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  InviteFields,
  inviteAction,
  listRoles,
  pageMembers,
  PendingInvitationList,
  pendingInvitations,
  type Member,
} from "@/features/team";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { keepSize, parsePage } from "@/lib/pagination";
import { normaliseSearch } from "@/lib/search";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { clientOptions } from "@/server/options";
import { hasPermission } from "@/server/tenancy/context";

export default async function TeamPage({ params, searchParams }: PageProps<"/[tenant]/team">) {
  const { tenant } = await params;
  const sp = await searchParams;
  const { ctx } = await requireTenantPermission(tenant, "members.read");
  const f = formatters(ctx);
  const canInvite = hasPermission(ctx, "members.invite");
  const canManage = hasPermission(ctx, "members.manage");
  const q = normaliseSearch(param(sp, "q"));
  // Two lists on one page: team (page, size) and client portal users (cpage, csize).
  const teamPage = parsePage(sp);
  const portalPage = parsePage(sp, { prefix: "c" });
  const path = tenantHref(tenant, "team");
  const database = db();
  const [internal, portal, roles, invitations, clients] = await Promise.all([
    pageMembers(database, ctx.tenant.id, { kind: "internal", q }, teamPage),
    pageMembers(database, ctx.tenant.id, { kind: "client", q }, portalPage),
    canInvite ? listRoles(database, ctx.tenant.id) : Promise.resolve([]),
    canInvite ? pendingInvitations(database, ctx.tenant.id) : Promise.resolve([]),
    clientOptions(database, ctx.tenant.id),
  ]);
  const clientName = new Map(clients.map((c) => [c.value, c.label]));

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
        <FilterBar keep={{ ...keepSize(teamPage), ...keepSize(portalPage) }}>
          <FilterSearch value={q} />
        </FilterBar>
        {internal.rows.length === 0 ? (
          q ? (
            <NoResults q={q} path={path} searchParams={sp} />
          ) : (
            <EmptyState title={t("team.noAccess")} />
          )
        ) : (
          table(internal.rows)
        )}
        <Pagination
          path={path}
          searchParams={sp}
          request={teamPage}
          paged={internal}
          locale={f.locale}
          label={t("team.members")}
        />
      </Section>

      <Section title={t("team.clients")}>
        {portal.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {q ? t("list.noResults", { q }) : t("clients.noPortalUsers")}
          </p>
        ) : (
          table(portal.rows)
        )}
        <Pagination
          path={path}
          searchParams={sp}
          request={portalPage}
          paged={portal}
          locale={f.locale}
          label={t("team.clients")}
        />
      </Section>

      {canInvite ? (
        <Section title={t("team.invitations")} description={t("access.team.invitationsSub")}>
          {invitations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("team.noInvitations")}</p>
          ) : (
            <PendingInvitationList
              tenant={tenant}
              invitations={invitations}
              formatDate={f.date}
              clientNames={clientName}
            />
          )}
        </Section>
      ) : null}
    </div>
  );
}
