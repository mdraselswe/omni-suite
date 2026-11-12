import { StatusBadge } from "@/components/data/status-badge";
import { t } from "@/i18n";
import type { ProposalDisplayStatus } from "./status";

/** A proposal's status badge; expired uses the overdue (warning) look. */
export function ProposalStatusBadge({ status }: { status: ProposalDisplayStatus }) {
  return (
    <StatusBadge status={status === "expired" ? "overdue" : status} label={t(`proposals.status.${status}`)} />
  );
}
