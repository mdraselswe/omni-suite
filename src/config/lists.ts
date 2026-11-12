import { listsSchema, type ListsConfig } from "./schema.ts";

/** ✏️ Pagination and search for every list in the app. */
const lists: ListsConfig = {
  pageSizes: [25, 50, 100],
  defaultPageSize: 50,
  searchDebounceMs: 300,
  searchMaxLength: 100,
  boardColumnSize: 50,
  previewSize: 10,
};

export const listsConfig = listsSchema.parse(lists);
