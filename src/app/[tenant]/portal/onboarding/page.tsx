import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { TextAreaField, TextField } from "@/components/form/field";
import { EmptyState, PageHeader, Section } from "@/components/layout/page";
import { onboardingForClient, submitOnboardingAction } from "@/features/clients";
import { t } from "@/i18n";
import { db } from "@/server/db";
import { portalPage } from "../_components/portal";

export default async function PortalOnboarding({ params }: PageProps<"/[tenant]/portal/onboarding">) {
  const { tenant } = await params;
  const { ctx, clientId } = await portalPage(tenant, "portal.onboarding");
  const f = formatters(ctx);
  const requests = await onboardingForClient(db(), ctx.tenant.id, clientId);
  const open = requests.find((r) => r.status === "sent");
  const done = requests.filter((r) => r.status !== "sent");

  return (
    <div className="grid gap-8">
      <PageHeader
        title={t("nav.portal.onboarding")}
        description={t("portal.onboardingSub", { business: ctx.tenant.name })}
      />

      {open ? (
        <Section title={open.templateName}>
          <ActionForm
            action={submitOnboardingAction.bind(null, tenant)}
            className="rounded-lg border bg-card p-4 sm:max-w-2xl"
          >
            <input type="hidden" name="id" value={open.id} />
            {open.fields.map((field) =>
              field.type === "textarea" ? (
                <TextAreaField
                  key={field.key}
                  name={`a_${field.key}`}
                  label={field.required ? `${field.label} *` : field.label}
                  required={field.required}
                  rows={4}
                />
              ) : (
                <TextField
                  key={field.key}
                  name={`a_${field.key}`}
                  label={field.required ? `${field.label} *` : field.label}
                  required={field.required}
                />
              ),
            )}
            <SubmitButton className="justify-self-start">{t("onboarding.submit")}</SubmitButton>
          </ActionForm>
        </Section>
      ) : done.length === 0 ? (
        <EmptyState title={t("portal.noOnboarding")} />
      ) : null}

      {done.map((r) => (
        <Section
          key={r.id}
          title={r.templateName}
          actions={<StatusBadge status={r.status} label={t(`onboarding.status.${r.status}`)} />}
        >
          <div className="grid gap-4 rounded-lg border bg-card p-4">
            {r.submittedAt ? (
              <p className="text-sm text-muted-foreground">
                {t("portal.submittedOn", { date: f.date(r.submittedAt.toISOString().slice(0, 10)) })}
              </p>
            ) : null}
            <dl className="grid gap-3 text-sm">
              {r.fields.map((field) => {
                const value = r.answers[field.key];
                return (
                  <div key={field.key} className="grid gap-0.5">
                    <dt className="font-medium">{field.label}</dt>
                    <dd className="whitespace-pre-line text-muted-foreground">
                      {typeof value === "string" && value ? value : "—"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </Section>
      ))}
    </div>
  );
}
