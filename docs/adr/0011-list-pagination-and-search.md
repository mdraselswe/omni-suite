# 11. List pagination and search

## Decision

- Every table-style list (staff and portal) shows numbered pages: `?page=` and `?size=` (sizes and default in `src/config/lists.ts`). `src/lib/pagination.ts` parses and clamps them, builds links that keep the other filters, and runs the count and the page query together (`paginate`). A page past the end shows the last page.
- Services expose `pageX(…, filter, page)` returning `{ rows, total, page, size }`, using `LIMIT/OFFSET` plus a `count(*)` with the same filters. Every order ends with the row id, so pages never overlap or skip rows. `listX` stays only where a capped, unpaged list is needed (dashboard, portal home, detail pages).
- The pager (`src/components/data/pagination.tsx`) is links and a GET form: it works without JavaScript. Small screens show "Page 2 of 25" instead of the numbers.
- Search: `?q=`, case-insensitive "contains" (`ILIKE`). Every word must match one of the searched columns; `%`, `_` and `\` are escaped, so they match themselves. With JavaScript the box updates the URL ~300 ms after typing (`router.replace`, back to page 1); without it, the filter form submits.
- The audit log moved from a "load older" cursor to numbered pages. The log only grows at the top, so a new entry can at worst repeat a row on the next page, never hide one.
- The leads board shows the newest `boardColumnSize` leads per stage (one window-function query) with the true count per column and a link to the list view, which pages through every lead with stage and search filters.
- Detail pages (a client's projects, proposals, invoices, files) show the newest `previewSize` rows and "View all (N)", linking to the main list filtered to that client.

## Why

Lists must stay fast with tens of thousands of rows, and people need to know how many results there are and jump between pages. Offset paging keeps links shareable and simple; at our sizes, a filtered `count(*)` on tenant-scoped indexes is cheap.

## Not done (yet)

- Trigram (`pg_trgm`) indexes for `ILIKE '%…%'`. Search scans the tenant's rows; add GIN trigram indexes if a tenant's search becomes slow.
- Keyset (cursor) paging for very deep pages.
- Partners stay unpaged: a business has a handful, and ownership percentages need the whole set.
