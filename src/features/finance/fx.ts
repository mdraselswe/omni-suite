import "server-only";
import { regionalConfig } from "@/config";
import { fxProvider } from "@/server/fx";
import type { TenantContext } from "@/server/tenancy/context";
import type { TransactionFx } from "./fx-rate-field";

/** Exchange-rate settings for the transaction form of one business. */
export function transactionFx(ctx: TenantContext, tenant: string): TransactionFx {
  return {
    tenant,
    base: ctx.tenant.settings.currency,
    locale: ctx.tenant.settings.locale,
    rates: fxProvider() !== null,
    attributionUrl: regionalConfig.fx.attributionUrl,
    // GST/VAT field on income and expenses only when the business charges tax.
    tax:
      ctx.tenant.settings.tax.rateBp > 0
        ? { name: ctx.tenant.settings.tax.name, rateBp: ctx.tenant.settings.tax.rateBp }
        : null,
  };
}
