import { ActionButton } from "@/components/form/action-button";
import { t } from "@/i18n";
import { shareUrl, type ShareKind } from "@/server/share-links";
import { CopyLinkButton } from "@/features/team";
import { shareLinkAction } from "./actions";

/**
 * Staff view of a document's share link: copy it to send by hand, or reset it so
 * an old link (sent to the wrong person, say) stops working.
 */
export function ShareLinkPanel({
  slug,
  kind,
  id,
  token,
  canWrite,
}: {
  slug: string;
  kind: ShareKind;
  id: string;
  token: string | null;
  canWrite: boolean;
}) {
  const action = shareLinkAction.bind(null, slug);
  if (!token) {
    return canWrite ? (
      <div className="grid gap-2 text-sm">
        <p className="text-muted-foreground">{t(`share.hint.${kind}`)}</p>
        <div>
          <ActionButton action={action} values={{ kind, id }}>
            {t("share.create")}
          </ActionButton>
        </div>
      </div>
    ) : null;
  }
  const url = shareUrl(kind, token);
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-muted-foreground">{t(`share.hint.${kind}`)}</p>
      <p className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">{url}</p>
      <div className="flex flex-wrap gap-2">
        <CopyLinkButton value={url} />
        {canWrite ? (
          <ActionButton
            action={action}
            values={{ kind, id, reset: "on" }}
            variant="ghost"
            confirm={t("share.resetConfirm")}
          >
            {t("share.reset")}
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}
