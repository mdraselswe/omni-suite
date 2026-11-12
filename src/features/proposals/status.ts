/** Proposal statuses as stored. */
export type StoredProposalStatus = "draft" | "sent" | "accepted" | "declined";

/** What people see: a sent proposal past its valid-until day shows as expired (computed, never stored). */
export type ProposalDisplayStatus = StoredProposalStatus | "expired";

/** Expired = still sent, and `today` is after the last valid day. */
export function isProposalExpired(
  p: { status: StoredProposalStatus; validUntil: string | null },
  today: string,
) {
  return p.status === "sent" && p.validUntil !== null && p.validUntil < today;
}

export function proposalDisplayStatus(
  p: { status: StoredProposalStatus; validUntil: string | null },
  today: string,
): ProposalDisplayStatus {
  return isProposalExpired(p, today) ? "expired" : p.status;
}
