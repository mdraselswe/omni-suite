"use client";

import { createContext, use, useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type FormState = {
  ok: boolean;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  at?: number;
} | null;

type FormAction = (state: FormState, formData: FormData) => Promise<FormState>;

const FormStateContext = createContext<FormState>(null);

/**
 * A form bound to a Server Action. Shows a toast with the result, exposes field
 * errors to <FieldError>, and resets after success unless `keepValues`.
 */
export function ActionForm({
  action,
  children,
  className,
  keepValues = false,
  onSuccess,
  ...rest
}: {
  action: FormAction;
  children: ReactNode;
  className?: string;
  keepValues?: boolean;
  onSuccess?: () => void;
} & Omit<React.ComponentProps<"form">, "action" | "children">) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!state?.message) return;
    if (state.ok) {
      toast.success(state.message);
      if (!keepValues) ref.current?.reset();
      onSuccess?.();
    } else {
      toast.error(state.message);
    }
    // `state.at` changes on every submit, so repeated identical messages still show.
  }, [state, keepValues, onSuccess]);

  return (
    <FormStateContext value={state}>
      <form ref={ref} action={formAction} className={cn("grid gap-4", className)} noValidate {...rest}>
        {children}
        {state && !state.ok && state.fieldErrors?._form ? (
          <p role="alert" className="text-sm text-destructive">
            {state.fieldErrors._form.join(" ")}
          </p>
        ) : null}
      </form>
    </FormStateContext>
  );
}

/** Error text for one field, linked to the input with aria-describedby={`${name}-error`}. */
export function FieldError({ name }: { name: string }) {
  const state = use(FormStateContext);
  const errors = state?.fieldErrors?.[name];
  if (!errors?.length) return null;
  return (
    <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
      {errors.join(" ")}
    </p>
  );
}

export function SubmitButton({
  children,
  pendingLabel,
  variant,
  size,
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      variant={variant}
      size={size}
      className={className}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  );
}
