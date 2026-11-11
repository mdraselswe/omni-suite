import { Badge } from "@/components/ui/badge";

type Tone = "default" | "success" | "warning" | "info" | "soft" | "destructive" | "outline";

const TONE: Record<string, Tone> = {
  active: "default",
  paid: "success",
  accepted: "success",
  done: "success",
  completed: "success",
  final: "success",
  won: "success",
  approved: "success",
  sent: "info",
  submitted: "info",
  partially_paid: "warning",
  proposed: "soft",
  in_progress: "info",
  review: "warning",
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
