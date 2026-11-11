import type { ReactNode } from "react";

/** Re-mounts on every navigation, so each page eases in (off with reduced motion). */
export default function TenantTemplate({ children }: { children: ReactNode }) {
  return <div className="animate-rise">{children}</div>;
}
