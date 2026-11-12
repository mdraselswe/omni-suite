import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { EmptyState, Section } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { assistantClientChoices, setPortalAssistantAction } from "@/features/assistant";
import { t } from "@/i18n";
import { PORTAL_ASSISTANT_MODES } from "@/lib/tenant-settings";
import { aiChain, providerStatuses } from "@/server/ai";
import { requireTenantPermission } from "@/server/auth/session";
import { db } from "@/server/db";
import { isModuleEnabled } from "@/server/tenancy/context";

export default async function AiSettingsPage({ params }: PageProps<"/[tenant]/settings/ai">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "settings.manage");
  if (!isModuleEnabled(ctx, "ai")) {
    return (
      <EmptyState title={t("assistant.settings.moduleOff")} body={t("assistant.settings.moduleOffSub")} />
    );
  }
  const current = ctx.tenant.settings.portalAssistant;
  const selected = new Set(current.clientIds);
  const choices = await assistantClientChoices(db(), ctx.tenant.id);
  const first = aiChain("portalAssistant")[0];
  const provider = first ? providerStatuses().find((s) => s.id === first.provider) : undefined;

  return (
    <ActionForm action={setPortalAssistantAction.bind(null, tenant)} keepValues className="max-w-3xl gap-8">
      <Section title={t("assistant.settings.title")} description={t("assistant.settings.sub")}>
        {provider ? (
          <p className="text-sm text-muted-foreground">
            {t("assistant.settings.provider", { provider: provider.label })}
          </p>
        ) : (
          <Alert>
            <AlertDescription>{t("assistant.settings.noProvider")}</AlertDescription>
          </Alert>
        )}
        {provider?.free === "yes-trains" ? (
          <Alert>
            <AlertDescription>
              {t("assistant.settings.trains", { provider: provider.label })}
            </AlertDescription>
          </Alert>
        ) : null}

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t("assistant.settings.who")}</legend>
          {PORTAL_ASSISTANT_MODES.map((mode) => (
            <label
              key={mode}
              className="flex items-start gap-3 surface p-3 text-sm has-[:checked]:border-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50"
            >
              <input
                type="radio"
                name="mode"
                value={mode}
                defaultChecked={current.mode === mode}
                className="mt-0.5 size-4 accent-primary"
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{t(`assistant.mode.${mode}`)}</span>
                <span className="text-xs text-muted-foreground">{t(`assistant.mode.${mode}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Section>

      <Section title={t("assistant.settings.clients")} description={t("assistant.settings.clientsSub")}>
        {choices.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("assistant.settings.noClients")}</p>
        ) : (
          <fieldset className="grid max-h-[28rem] gap-1 overflow-y-auto surface p-2">
            <legend className="sr-only">{t("assistant.settings.clients")}</legend>
            {choices.map((c) => (
              <label
                key={c.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 text-sm hover:bg-accent"
              >
                <input
                  type="checkbox"
                  name="clientIds"
                  value={c.id}
                  defaultChecked={selected.has(c.id)}
                  className="size-4 rounded border-input accent-primary"
                />
                <span className="font-medium">{c.name}</span>
                {c.status === "inactive" ? (
                  <Badge variant="outline">{t("assistant.settings.inactive")}</Badge>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {c.portalUsers > 0
                    ? t("assistant.settings.portalUsers", { count: c.portalUsers })
                    : t("assistant.settings.noPortalUsers")}
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel={t("form.saving")}>{t("assistant.settings.save")}</SubmitButton>
        <p className="text-xs text-muted-foreground">{t("assistant.settings.roles")}</p>
      </div>
    </ActionForm>
  );
}
