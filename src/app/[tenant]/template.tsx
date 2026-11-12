import type { ReactNode } from "react";

/**
 * Re-mounts on every navigation, so each page eases in: its top-level blocks
 * (title, filters, cards, tables) rise one after another. Off with reduced motion.
 */
export default function TenantTemplate({ children }: { children: ReactNode }) {
  return <div className="cascade">{children}</div>;
}
