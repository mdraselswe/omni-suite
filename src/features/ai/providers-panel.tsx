import { Badge } from "@/components/ui/badge";
import { t } from "@/i18n";
import { providerStatuses } from "@/server/ai";

/**
 * Platform admin: which AI providers have a key and how src/config/ai.ts uses them.
 * Read-only and secret-free (key names only). `pnpm ai:check` tests the keys.
 */
export function AiProvidersPanel() {
  const statuses = providerStatuses();
  const anyKey = statuses.some((s) => s.hasKey);
  return (
    <section className="grid gap-3" aria-labelledby="ai-providers">
      <div className="grid gap-1">
        <h2 id="ai-providers" className="text-lg font-semibold">
          {t("ai.providers.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("ai.providers.sub")}</p>
        {anyKey ? null : <p className="text-sm text-muted-foreground">{t("ai.providers.noneOn")}</p>}
      </div>
      <ul className="grid gap-2 md:grid-cols-2">
        {statuses.map((s) => (
          <li key={s.id} className="grid gap-1.5 surface p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{s.label}</span>
              <Badge variant={s.hasKey ? "success" : "outline"}>
                {s.hasKey ? t("ai.providers.on") : t("ai.providers.off")}
              </Badge>
              {s.isDefault ? <Badge variant="info">{t("ai.providers.default")}</Badge> : null}
              {s.fallbackOrder ? (
                <Badge variant="soft">{t("ai.providers.fallback", { n: s.fallbackOrder })}</Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("ai.providers.model")}: <code>{s.model}</code> · {t("ai.providers.key")}:{" "}
              <code>{s.keyName}</code>
            </p>
            <p className="text-xs text-muted-foreground">
              {t(`ai.providers.free.${s.free}`)}
              {s.features.length > 0 ? ` · ${t("ai.providers.usedBy")}: ${s.features.join(", ")}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("ai.providers.howTo")}</p>
    </section>
  );
}
