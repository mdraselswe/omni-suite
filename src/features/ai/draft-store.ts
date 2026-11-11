import { useSyncExternalStore } from "react";
import type { LineItem } from "@/lib/line-items";

/**
 * Hands AI-drafted line items from the draft box to the line items editor on the
 * same form (they sit in different places in the form, so they share this store).
 */
type Entry = { version: number; items: LineItem[] };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();

export function publishDraftItems(scope: string, items: LineItem[]): void {
  const version = (entries.get(scope)?.version ?? 0) + 1;
  entries.set(scope, { version, items });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The latest drafted items for a form, or null (always null on the server). */
export function useDraftItems(scope: string): Entry | null {
  return useSyncExternalStore(
    subscribe,
    () => entries.get(scope) ?? null,
    () => null,
  );
}
