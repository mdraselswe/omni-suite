"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { FormState } from "./action-form";

function Submit({
  children,
  variant,
  size,
  confirm,
}: {
  children: ReactNode;
  variant: React.ComponentProps<typeof Button>["variant"];
  size: React.ComponentProps<typeof Button>["size"];
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      disabled={pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </Button>
  );
}

/** One-click Server Action (approve, reverse, delete…) with optional confirm and hidden values. */
export function ActionButton({
  action,
  children,
  values = {},
  variant = "outline",
  size = "sm",
  confirm,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children: ReactNode;
  values?: Record<string, string>;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  useEffect(() => {
    if (!state?.message) return;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);
  return (
    <form action={formAction} className="inline-flex">
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Submit variant={variant} size={size} confirm={confirm}>
        {children}
      </Submit>
    </form>
  );
}
