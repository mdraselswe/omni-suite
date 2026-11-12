import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { inviteAction, pendingInvitations, PendingInvitationList, type Member } from "@/features/team";
import { t } from "@/i18n";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

/**
 * Who from this client can sign in to the portal, plus their pending
 * invitations (resend / revoke need members.invite, like inviting).
 */
export async function ClientPortalUsersSection({
  ctx,
  tenant,
  client,
  portalUsers,
  clientRoles,
  canInvite,
}: {
  ctx: TenantContext;
  tenant: string;
  client: { id: string; email: string; billingEmail: string };
  portalUsers: readonly Member[];
  clientRoles: readonly { id: string; key: string; name: string; description: string }[];
  canInvite: boolean;
}) {
  const f = formatters(ctx);
  const invitations = canInvite ? await pendingInvitations(db(), ctx.tenant.id, { clientId: client.id }) : [];

  return (
    <Section
      title={t("clients.portalUsers")}
      actions={
        canInvite && clientRoles.length > 0 ? (
          <FormDialog
            trigger={t("clients.invitePortal")}
            title={t("clients.invitePortal")}
            description={t("access.client.inviteHint")}
            action={inviteAction.bind(null, tenant)}
            submitLabel={t("team.invite")}
            size="sm"
          >
            <input type="hidden" name="kind" value="client" />
            <input type="hidden" name="clientId" value={client.id} />
            <TextField
              name="email"
              label={t("form.email.label")}
              type="email"
              defaultValue={client.email || client.billingEmail}
              required
            />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t("team.roles")}</legend>
              {clientRoles.map((role) => (
                <label key={role.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="roleIds"
                    value={role.id}
                    defaultChecked={role.key === "client_owner"}
                    className="mt-0.5 size-4 rounded border-input accent-primary"
                  />
                  <span className="grid">
                    <span>{role.name}</span>
                    {role.description ? (
                      <span className="text-xs text-muted-foreground">{role.description}</span>
                    ) : null}
                  </span>
                </label>
              ))}
            </fieldset>
          </FormDialog>
        ) : null
      }
    >
      {portalUsers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {invitations.length > 0 ? t("access.client.onlyInvited") : t("clients.noPortalUsers")}
        </p>
      ) : (
        <ul className="grid gap-2">
          {portalUsers.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
            >
              <span className="grid">
                <span className="font-medium">{m.name}</span>
                <span className="text-xs break-all text-muted-foreground">{m.email}</span>
              </span>
              <span className="flex flex-wrap gap-1">
                {m.roles.map((r) => (
                  <Badge key={r.roleId} variant="outline">
                    {r.name}
                  </Badge>
                ))}
                {m.status === "disabled" ? (
                  <StatusBadge status="disabled" label={t("team.statusDisabled")} />
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {invitations.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">{t("team.invitations")}</h3>
          <PendingInvitationList tenant={tenant} invitations={invitations} formatDate={f.date} />
        </div>
      ) : null}
    </Section>
  );
}
