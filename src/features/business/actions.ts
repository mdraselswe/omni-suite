"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { t } from "@/i18n";
import { isSupportedCurrency, isSupportedTimeZone } from "@/lib/intl-options";
import { fields, formObject, runAction, UserError, type ActionState } from "@/server/action";
import { requireUser } from "@/server/auth/session";
import { db } from "@/server/db";
import { createTenant, isValidSlug, suggestSlug } from "@/server/tenancy/service";

const schema = z.object({
  name: fields.required(120),
  slug: fields.text(48).transform((s) => s.toLowerCase()),
  // Empty (no JavaScript, older form) falls back to the defaults in tenantSettingsSchema.
  currency: fields.text(3).refine((v) => v === "" || isSupportedCurrency(v), t("locale.badCurrency")),
  timezone: fields.text(60).refine((v) => v === "" || isSupportedTimeZone(v), t("locale.badTimezone")),
});

/** Creates a business with the signed-in user as owner, then opens it. */
export async function createBusinessAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let slug = "";
  const state = await runAction(async () => {
    const user = await requireUser();
    const input = schema.parse(formObject(formData));
    slug = input.slug || (await suggestSlug(db(), input.name));
    if (!isValidSlug(slug)) throw new UserError(t("business.slugInvalid"));
    try {
      await createTenant(db(), {
        name: input.name,
        slug,
        ownerUserId: user.id,
        settings: {
          ...(input.currency ? { currency: input.currency } : {}),
          ...(input.timezone ? { timezone: input.timezone } : {}),
        },
      });
    } catch (error) {
      if (String(error).includes("tenants_slug_unique") || String(error).includes("duplicate key")) {
        throw new UserError(t("business.slugTaken"));
      }
      throw error;
    }
  });
  if (state?.ok) redirect(`/${slug}` as "/");
  return state;
}
