import { ActionButton } from "@/components/form/action-button";
import { Section } from "@/components/layout/page";
import { Badge } from "@/components/ui/badge";
import { optionalModules, setModuleAction } from "@/features/settings";
import { t } from "@/i18n";
import { requireTenantPermission } from "@/server/auth/session";

export default async function ModulesPage({ params }: PageProps<"/[tenant]/settings/modules">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "settings.manage");
  const disabled = new Set(ctx.tenant.settings.disabledModules);

  return (
    <Section title={t("settings.modules")} description={t("settings.modulesSub")}>
      <ul className="grid gap-2 md:grid-cols-2">
        {optionalModules().map((m) => {
          const on = !disabled.has(m.key);
          return (
            <li key={m.key} className="flex items-center justify-between gap-3 surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t(m.label)}</span>
                <Badge variant={on ? "default" : "outline"}>
                  {on ? t("settings.enabled") : t("settings.disabled")}
                </Badge>
              </div>
              <ActionButton
                action={setModuleAction.bind(null, tenant)}
                values={{ key: m.key, enabled: on ? "false" : "true" }}
                variant={on ? "outline" : "default"}
                confirm={on ? t("form.confirm") : undefined}
              >
                {on ? t("settings.disable") : t("settings.enable")}
              </ActionButton>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
