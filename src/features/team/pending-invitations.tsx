import { ActionButton } from "@/components/form/action-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { resendInvitationAction, revokeInvitationAction } from "./actions";
import { CopyLinkButton } from "./copy-link-button";
import { inviteLink, type PendingInvitation } from "./service";

/**
 * Pending invitations with what the business needs to follow up: who, which
 * roles, when it was sent, when it expires, and Resend / Revoke (both need
 * members.invite, checked again by the actions). Used on the team page and on
 * a client's page (portal invitations of that client).
 */
export function PendingInvitationList({
  tenant,
  invitations,
  formatDate,
  clientNames,
  showLink = true,
}: {
  tenant: string;
  invitations: readonly PendingInvitation[];
  /** ISO date (yyyy-mm-dd) → the business's date format. */
  formatDate: (iso: string) => string;
  /** Client names for portal invitations (team page); omit on a client's own page. */
  clientNames?: ReadonlyMap<string, string>;
  showLink?: boolean;
}) {
  const day = (d: Date) => formatDate(d.toISOString().slice(0, 10));
  return (
    <ul className="grid gap-2">
      {invitations.map((inv) => {
        const link = inviteLink(inv.token);
        const client = inv.clientId ? clientNames?.get(inv.clientId) : undefined;
        return (
          <li key={inv.id} className="grid gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="grid min-w-0 gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-medium break-all">{inv.email}</span>
                  <Badge variant="outline">{t(`team.kind.${inv.kind}`)}</Badge>
                  {inv.expired ? <Badge variant="warning">{t("access.invite.expiredBadge")}</Badge> : null}
                </div>
                {client ? <span className="text-xs text-muted-foreground">{client}</span> : null}
                <span className="text-xs text-muted-foreground">
                  {inv.roleNames.length > 0 ? inv.roleNames.join(", ") : t("team.noRoles")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {inv.inviterName
                    ? t("access.invite.sentBy", { date: day(inv.sentAt), name: inv.inviterName })
                    : t("access.invite.sentOn", { date: day(inv.sentAt) })}
                  {" · "}
                  {inv.expired
                    ? t("access.invite.expiredOn", { date: day(inv.expiresAt) })
                    : t("team.expiresOn", { date: day(inv.expiresAt) })}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                <ActionButton
                  action={resendInvitationAction.bind(null, tenant)}
                  values={{ id: inv.id }}
                  confirm={t("access.invite.resendConfirm", { email: inv.email })}
                  variant="outline"
                >
                  {t("access.invite.resend")}
                </ActionButton>
                <ActionButton
                  action={revokeInvitationAction.bind(null, tenant)}
                  values={{ id: inv.id }}
                  confirm={t("access.invite.revokeConfirm", { email: inv.email })}
                  variant="ghost"
                >
                  {t("team.revoke")}
                </ActionButton>
              </div>
            </div>
            {showLink && !inv.expired ? (
              <div className="grid gap-1">
                <label htmlFor={`invite-${inv.id}`} className="text-xs text-muted-foreground">
                  {t("team.inviteLink")}
                </label>
                <div className="flex gap-2">
                  <Input
                    id={`invite-${inv.id}`}
                    readOnly
                    value={link}
                    aria-describedby={`invite-${inv.id}-hint`}
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <CopyLinkButton value={link} />
                </div>
                <p id={`invite-${inv.id}-hint`} className="text-xs text-muted-foreground">
                  {t("access.invite.linkHint")}
                </p>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
