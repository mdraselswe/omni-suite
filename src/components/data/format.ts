import { formatDate, formatMinutes } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import type { TenantContext } from "@/server/tenancy/context";

/** Formatters bound to a tenant's currency and locale. */
export function formatters(ctx: Pick<TenantContext, "tenant">) {
  const { currency, locale } = ctx.tenant.settings;
  return {
    money: (minor: bigint | string | number, cur = currency) => formatMoney(BigInt(minor), cur, locale),
    date: (iso: string | null | undefined) => formatDate(iso, locale),
    minutes: formatMinutes,
    percent: (bp: number) => `${(bp / 100).toLocaleString(locale, { maximumFractionDigits: 2 })}%`,
    currency,
    locale,
  };
}
