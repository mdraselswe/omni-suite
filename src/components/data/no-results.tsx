import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/layout/page";
import { ButtonLink } from "@/components/ui/button-link";
import { t } from "@/i18n";
import { appHref } from "@/lib/href";
import { queryWith, type SearchParams } from "@/lib/pagination";

/** Empty list because of a search: says so and links to the same list without the search. */
export function NoResults({
  q,
  path,
  searchParams,
  bare,
}: {
  q: string;
  /** The list's own path, e.g. tenantHref(tenant, "clients"). */
  path: string;
  searchParams: SearchParams;
  bare?: boolean;
}) {
  const changes: Record<string, null> = { q: null };
  for (const key of Object.keys(searchParams)) if (/page$/.test(key)) changes[key] = null;
  return (
    <EmptyState
      icon={SearchX}
      title={t("list.noResults", { q })}
      body={t("list.noResultsBody")}
      bare={bare}
      action={
        <ButtonLink href={appHref(`${path}${queryWith(searchParams, changes)}`)} variant="outline" size="sm">
          {t("list.clearSearch")}
        </ButtonLink>
      }
    />
  );
}
