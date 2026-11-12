import Link from "next/link";
import { formatters } from "@/components/data/format";
import { StatusBadge } from "@/components/data/status-badge";
import { ActionForm, SubmitButton } from "@/components/form/action-form";
import { CheckboxField, SelectField, TextField } from "@/components/form/field";
import { FormDialog } from "@/components/form/form-dialog";
import { EmptyState, Section } from "@/components/layout/page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  answerFileIds,
  onboardingAnswerFiles,
  type onboardingForClient,
  onboardingReach,
  sendOnboardingAction,
  updateChecklistAction,
  type OnboardingField,
} from "@/features/clients";
import { formatBytes } from "@/features/files";
import { t } from "@/i18n";
import { tenantHref } from "@/lib/href";
import { db } from "@/server/db";
import type { TenantContext } from "@/server/tenancy/context";

const link = "font-medium underline-offset-4 hover:underline";

type Request = Awaited<ReturnType<typeof onboardingForClient>>[number];

/**
 * A client's onboarding forms (staff view): send one, read the answers (files
 * as download links), tick the checklist. Sending never goes nowhere: when
 * nobody at the client can open the portal yet, the dialog offers to invite
 * the first portal user in the same step.
 */
export async function ClientOnboardingSection({
  ctx,
  tenant,
  client,
  onboarding,
  templates,
  canOnboard,
  canInvite,
}: {
  ctx: TenantContext;
  tenant: string;
  client: { id: string; name: string; email: string; billingEmail: string };
  onboarding: readonly Request[];
  templates: readonly { id: string; name: string }[];
  canOnboard: boolean;
  canInvite: boolean;
}) {
  const f = formatters(ctx);
  const database = db();
  const fileIds = onboarding.flatMap((req) =>
    req.fields
      .filter((field) => field.type === "file")
      .flatMap((field) => answerFileIds(req.answers[field.key])),
  );
  const [reach, answerFiles] = await Promise.all([
    canOnboard ? onboardingReach(database, ctx.tenant.id, client.id) : Promise.resolve(null),
    onboardingAnswerFiles(database, ctx.tenant.id, client.id, fileIds),
  ]);
  const nobody = reach !== null && reach.canAnswer === 0;
  const needsInvite = nobody && reach.pendingInvites === 0;

  const answer = (req: Request, field: OnboardingField) => {
    const value = req.answers[field.key];
    if (field.type === "file") {
      const ids = answerFileIds(value);
      if (ids.length === 0) return null;
      return (
        <ul className="grid gap-1">
          {ids.map((id) => {
            const file = answerFiles.get(id);
            return (
              <li key={id}>
                {file ? (
                  <a href={`/api/t/${tenant}/files/${id}/`} className={link}>
                    {file.name}
                    <span className="text-xs font-normal text-muted-foreground">
                      {" "}
                      ({formatBytes(file.size)})
                    </span>
                  </a>
                ) : (
                  <span className="text-muted-foreground">{t("access.onboarding.fileGone")}</span>
                )}
              </li>
            );
          })}
        </ul>
      );
    }
    return typeof value === "string" && value ? value : null;
  };

  return (
    <Section
      title={t("onboarding.title")}
      actions={
        canOnboard && templates.length > 0 ? (
          <FormDialog
            trigger={t("onboarding.send")}
            title={t("onboarding.send")}
            description={
              needsInvite
                ? t(
                    reach.portalUsers > 0
                      ? "access.onboarding.noOneMayAnswer"
                      : "access.onboarding.noPortalUser",
                    { client: client.name },
                  )
                : undefined
            }
            action={sendOnboardingAction.bind(null, tenant)}
            submitLabel={t("onboarding.send")}
            size="sm"
          >
            <input type="hidden" name="clientId" value={client.id} />
            <SelectField
              name="templateId"
              label={t("onboarding.template")}
              options={templates.map((tp) => ({ value: tp.id, label: tp.name }))}
            />
            {needsInvite && canInvite ? (
              <>
                <CheckboxField
                  name="invite"
                  label={t("access.onboarding.inviteToo")}
                  hint={t("access.onboarding.inviteTooHint")}
                  defaultChecked
                />
                <TextField
                  name="inviteEmail"
                  label={t("form.email.label")}
                  type="email"
                  defaultValue={client.email || client.billingEmail}
                  autoComplete="off"
                />
              </>
            ) : null}
            {needsInvite && !canInvite ? (
              <p className="text-sm text-muted-foreground">{t("access.onboarding.askInviter")}</p>
            ) : null}
          </FormDialog>
        ) : null
      }
    >
      {canOnboard && templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("onboarding.needTemplate")}{" "}
          <Link href={tenantHref(tenant, "clients/onboarding")} className={link}>
            {t("onboarding.templates")}
          </Link>
        </p>
      ) : null}
      {nobody ? (
        <Alert>
          <AlertDescription>
            {reach.pendingInvites > 0
              ? t("access.onboarding.waitingForInvite", { count: reach.pendingInvites, client: client.name })
              : t(
                  reach.portalUsers > 0
                    ? "access.onboarding.noOneMayAnswer"
                    : "access.onboarding.noPortalUser",
                  {
                    client: client.name,
                  },
                )}
          </AlertDescription>
        </Alert>
      ) : null}
      {onboarding.length === 0 ? (
        <EmptyState title={t("onboarding.none")} />
      ) : (
        <div className="grid gap-3">
          {onboarding.map((req) => (
            <article key={req.id} className="grid gap-4 surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{req.templateName}</p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {t("onboarding.sentOn", { date: f.date(req.createdAt.toISOString().slice(0, 10)) })}
                  </span>
                  <StatusBadge status={req.status} label={t(`onboarding.status.${req.status}`)} />
                </div>
              </div>
              {req.fields.length > 0 ? (
                <div className="grid gap-2">
                  <h3 className="text-sm font-semibold">{t("onboarding.answers")}</h3>
                  <dl className="grid gap-2 text-sm">
                    {req.fields.map((field) => {
                      const shown = answer(req, field);
                      return (
                        <div key={field.key} className="grid gap-0.5">
                          <dt className="text-xs text-muted-foreground">{field.label}</dt>
                          <dd className="break-words whitespace-pre-line">
                            {shown ?? (
                              <span className="text-muted-foreground">{t("onboarding.noAnswer")}</span>
                            )}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ) : null}
              {req.checklist.length > 0 || canOnboard ? (
                canOnboard && req.status !== "completed" ? (
                  <ActionForm action={updateChecklistAction.bind(null, tenant)} keepValues className="gap-3">
                    <input type="hidden" name="id" value={req.id} />
                    <fieldset className="grid gap-2">
                      <legend className="mb-1 text-sm font-semibold">{t("onboarding.checklist")}</legend>
                      {req.checklist.map((item) => (
                        <label key={item} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="done"
                            value={item}
                            defaultChecked={req.checklistDone.includes(item)}
                            className="size-4 rounded border-input accent-primary"
                          />
                          {item}
                        </label>
                      ))}
                    </fieldset>
                    <CheckboxField name="complete" label={t("onboarding.markComplete")} />
                    <SubmitButton variant="outline" size="sm" className="justify-self-start">
                      {t("onboarding.saveChecklist")}
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <ul className="grid gap-1 text-sm">
                    {req.checklist.map((item) => (
                      <li
                        key={item}
                        className={
                          req.checklistDone.includes(item) ? "text-muted-foreground line-through" : undefined
                        }
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}
