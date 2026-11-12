import "server-only";
import { and, ilike, or, type SQL } from "drizzle-orm";
import { containsPattern, searchTerms } from "@/lib/search";

type Searchable = Parameters<typeof ilike>[0];

/**
 * Case-insensitive "contains" search over some columns. Every word of `q` must match
 * at least one column ("acme web" finds "Website" for the client "Acme"). Wildcards in
 * the text are escaped, so `%` and `_` match themselves. Undefined when there is no search.
 */
export function matchesSearch(q: string | undefined, columns: readonly Searchable[]): SQL | undefined {
  const terms = searchTerms(q ?? "");
  if (terms.length === 0 || columns.length === 0) return undefined;
  return and(...terms.map((term) => or(...columns.map((c) => ilike(c, containsPattern(term))))));
}
