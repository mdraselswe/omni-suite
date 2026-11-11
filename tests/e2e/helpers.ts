import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Demo sign-ins from `pnpm db:seed` (sample accounts only). */
export const PASSWORD = "omnisuite-demo-2026";
export const ROLES = ["owner", "staff", "client"] as const;
export type Role = (typeof ROLES)[number];
export const stateFile = (role: Role) => `playwright/.auth/${role}.json`;

export async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();
  expect(violations.map((v) => `${v.id}: ${v.help} (${v.nodes[0]?.target.join(" ") ?? ""})`)).toEqual([]);
}
