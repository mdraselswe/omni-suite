import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { SelectField, TextAreaField, TextField } from "@/components/form/field";
import { EmptyState, PageHeader, Section } from "@/components/layout/page";
import {
  answerFileIds,
  onboardingForClient,
  OnboardingFileAnswer,
  submitOnboardingAction,
  type OnboardingField,
} from "@/features/clients";
import { listFiles } from "@/features/files";
import { t } from "@/i18n";
import { businessName } from "@/lib/business-name";
import { db } from "@/server/db";
import { hasPermission } from "@/server/tenancy/context";
import { portalPage } from "../_components/portal";

export default async function PortalOnboarding({ params }: PageProps<"/[tenant]/portal/onboarding">) {
  const { tenant } = await params;
  const { ctx, clientId } = await portalPage(tenant, "portal.onboarding");
  const f = formatters(ctx);
  const database = db();
  const requests = await onboardingForClient(database, ctx.tenant.id, clientId);
  // Every form still waiting is shown, not just the newest.
  const open = requests.filter((r) => r.status === "sent");
  const done = requests.filter((r) => r.status !== "sent");
  const needsFiles = requests.some((r) => r.fields.some((field) => field.type === "file"));
  // The client's own shared files: what a file question can point at, and how answers are named.
  const clientFiles = needsFiles
    ? (await listFiles(database, ctx, "all", { entityType: "client", entityId: clientId })).map(
        ({ file }) => ({
          id: file.id,
          name: file.name,
        }),
      )
    : [];
  const fileName = new Map(clientFiles.map((file) => [file.id, file.name]));
  const canUpload = hasPermission(ctx, "portal.files");

  const question = (field: OnboardingField) => {
    const name = `a_${field.key}`;
    const label = field.required ? `${field.label} *` : field.label;
    switch (field.type) {
      case "textarea":
        return <TextAreaField key={field.key} name={name} label={label} required={field.required} rows={4} />;
      case "select":
        return (
          <SelectField
            key={field.key}
            name={name}
            label={label}
            required={field.required}
            placeholder={t("access.onboarding.choose")}
            defaultValue=""
            options={field.options.map((o) => ({ value: o, label: o }))}
          />
        );
      case "file":
        return (
          <OnboardingFileAnswer
            key={field.key}
            tenant={tenant}
            clientId={clientId}
            fieldKey={field.key}
            label={field.label}
            required={field.required}
            files={clientFiles}
            canUpload={canUpload}
          />
        );
      default:
        return <TextField key={field.key} name={name} label={label} required={field.required} />;
    }
  };

  return (
    <div className="grid gap-8">
      <PageHeader
        title={t("nav.portal.onboarding")}
        description={t("portal.onboardingSub", { business: businessName(ctx.tenant) })}
      />

      {open.map((req) => (
        <Section key={req.id} title={req.templateName}>
          <ActionForm action={submitOnboardingAction.bind(null, tenant)} className="surface p-4 sm:max-w-2xl">
            <input type="hidden" name="id" value={req.id} />
            {req.fields.map(question)}
            <SubmitButton className="justify-self-start">{t("onboarding.submit")}</SubmitButton>
          </ActionForm>
        </Section>
      ))}
      {open.length === 0 && done.length === 0 ? <EmptyState title={t("portal.noOnboarding")} /> : null}

      {done.map((r) => (
        <Section
          key={r.id}
          title={r.templateName}
          actions={<StatusBadge status={r.status} label={t(`onboarding.status.${r.status}`)} />}
        >
          <div className="grid gap-4 surface p-4">
            {r.submittedAt ? (
              <p className="text-sm text-muted-foreground">
                {t("portal.submittedOn", { date: f.date(r.submittedAt.toISOString().slice(0, 10)) })}
              </p>
            ) : null}
            <dl className="grid gap-3 text-sm">
              {r.fields.map((field) => {
                const value = r.answers[field.key];
                const shown =
                  field.type === "file"
                    ? answerFileIds(value)
                        .map((id) => fileName.get(id) ?? t("access.onboarding.fileGone"))
                        .join(", ")
                    : typeof value === "string"
                      ? value
                      : "";
                return (
                  <div key={field.key} className="grid gap-0.5">
                    <dt className="font-medium">{field.label}</dt>
                    <dd className="break-words whitespace-pre-line text-muted-foreground">{shown || "—"}</dd>
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
