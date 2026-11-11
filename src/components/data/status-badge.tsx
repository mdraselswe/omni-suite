import { Badge } from "@/components/ui/badge";

const TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  paid: "default",
  accepted: "default",
  done: "default",
  completed: "default",
  final: "default",
  won: "default",
  approved: "default",
  sent: "secondary",
  submitted: "secondary",
  partially_paid: "secondary",
  proposed: "secondary",
  in_progress: "secondary",
  review: "secondary",
  draft: "outline",
  todo: "outline",
  planning: "outline",
  overdue: "destructive",
  rejected: "destructive",
  declined: "destructive",
  void: "destructive",
  lost: "destructive",
  disabled: "destructive",
  suspended: "destructive",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <Badge variant={TONE[status] ?? "outline"}>{label}</Badge>;
}
