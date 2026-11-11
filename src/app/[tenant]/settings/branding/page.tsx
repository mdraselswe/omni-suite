import { ActionForm, FieldError, SubmitButton } from "@/components/form/action-form";
import { CheckboxField, TextField } from "@/components/form/field";
import { BrandMark } from "@/components/layout/brand-mark";
import { Section } from "@/components/layout/page";
import { SIDEBAR_STYLES, site, THEME_PRESETS, themePresets, type ThemePresetKey } from "@/config";
import { updateBrandingAction } from "@/features/settings";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { requireTenantPermission } from "@/server/auth/session";

const tile =
  "surface relative flex cursor-pointer flex-col gap-3 p-4 transition-shadow has-checked:ring-2 has-checked:ring-primary has-focus-visible:ring-3 has-focus-visible:ring-ring/50";

/** Colours of a preset, shown as a strip of dots (preview only; values come from src/config/themes.ts). */
function Swatches({ preset }: { preset: ThemePresetKey }) {
  const p = themePresets[preset];
  return (
    <span className="flex gap-1.5" aria-hidden="true">
      <span className="size-7 rounded-full ring-2 ring-card" style={{ background: p.primary.light }} />
      {p.gradients.map(([from, to]) => (
        <span
          key={`${from}${to}`}
          className="size-7 rounded-full ring-2 ring-card"
          style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
        />
      ))}
    </span>
  );
}

function SidebarPreview({ style }: { style: (typeof SIDEBAR_STYLES)[number] }) {
  return (
    <span
      data-sidebar={style}
      className="flex h-20 overflow-hidden rounded-lg ring-1 ring-border"
      aria-hidden="true"
    >
      <span className="grid w-1/3 content-start gap-1.5 bg-sidebar p-2">
        <span className="h-1.5 w-3/4 rounded-full bg-sidebar-foreground/40" />
        <span className="h-3 rounded-r-full bg-sidebar-primary" />
        <span className="h-1.5 w-2/3 rounded-full bg-sidebar-foreground/30" />
        <span className="h-1.5 w-1/2 rounded-full bg-sidebar-foreground/30" />
      </span>
      <span className="grid flex-1 content-start gap-1.5 bg-background p-2">
        <span className="h-4 rounded bg-card shadow-surface" />
        <span className="h-6 rounded bg-card shadow-surface" />
      </span>
    </span>
  );
}

export default async function BrandingPage({ params }: PageProps<"/[tenant]/settings/branding">) {
  const { tenant } = await params;
  const { ctx } = await requireTenantPermission(tenant, "settings.manage");
  const b = ctx.tenant.settings.branding;
  const name = b.displayName || ctx.tenant.name;

  return (
    <ActionForm action={updateBrandingAction.bind(null, tenant)} keepValues className="max-w-4xl gap-10">
      <Section title={t("branding.colours")} description={t("branding.coloursSub")}>
        <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">{t("branding.colours")}</legend>
          {(["", ...THEME_PRESETS] as const).map((key) => (
            <label key={key || "default"} className={tile}>
              <input
                type="radio"
                name="preset"
                value={key}
                defaultChecked={b.preset === key}
                className="sr-only"
              />
              <Swatches preset={key || site.theme.preset} />
              <span className="text-sm font-medium">
                {key ? t(`theme.preset.${key}`) : t("branding.platformDefault")}
              </span>
            </label>
          ))}
        </fieldset>
        <FieldError name="preset" />
        <div className="grid gap-4 surface p-5 sm:grid-cols-[1fr_auto] sm:items-end">
          <CheckboxField
            name="useBrandColor"
            label={t("branding.ownColour")}
            hint={t("branding.ownColourHint")}
            defaultChecked={b.brandColor !== ""}
          />
          <div className="grid gap-1.5">
            <label htmlFor="brandColor" className="text-sm font-medium">
              {t("branding.colour")}
            </label>
            <input
              id="brandColor"
              name="brandColor"
              type="color"
              defaultValue={b.brandColor || themePresets[b.preset || site.theme.preset].primary.light}
              aria-describedby="brandColor-error"
              className="h-10 w-24 cursor-pointer rounded-lg border border-input bg-card p-1"
            />
            <FieldError name="brandColor" />
          </div>
        </div>
      </Section>

      <Section title={t("branding.sidebar")} description={t("branding.sidebarSub")}>
        <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">{t("branding.sidebar")}</legend>
          {(["", ...SIDEBAR_STYLES] as const).map((style) => (
            <label key={style || "default"} className={tile}>
              <input
                type="radio"
                name="sidebar"
                value={style}
                defaultChecked={b.sidebar === style}
                className="sr-only"
              />
              <SidebarPreview style={style || site.theme.sidebar} />
              <span className="text-sm font-medium">
                {style ? t(`theme.sidebar.${style}`) : t("branding.platformDefault")}
              </span>
            </label>
          ))}
        </fieldset>
        <FieldError name="sidebar" />
      </Section>

      <Section title={t("branding.logo")}>
        <div className="grid items-center gap-5 surface p-5 sm:grid-cols-[auto_1fr]">
          <BrandMark
            name={name}
            logoUrl={b.logoUrl || undefined}
            className={cn("size-16 rounded-2xl text-lg")}
          />
          <TextField
            name="logoUrl"
            label={t("branding.logoUrl")}
            hint={t("branding.logoHint")}
            type="url"
            inputMode="url"
            placeholder="https://"
            defaultValue={b.logoUrl}
          />
        </div>
      </Section>

      <SubmitButton className="justify-self-start" pendingLabel={t("form.saving")}>
        {t("branding.save")}
      </SubmitButton>
    </ActionForm>
  );
}
