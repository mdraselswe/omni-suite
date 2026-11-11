/** Cookie that remembers a collapsed sidebar (read on the server, so the first paint is right). */
export const SIDEBAR_COOKIE = "omnisuite-sidebar";

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((part) => part[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}
