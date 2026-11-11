"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import type { FormState } from "@/components/form/action-form";
import { t } from "@/i18n";

const STATUSES = ["todo", "in_progress", "review", "done"] as const;

/** Changes a task's status as soon as another option is picked. */
export function TaskStatusSelect({
  action,
  id,
  status,
  label,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  id: string;
  status: string;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  useEffect(() => {
    if (state && !state.ok && state.message) toast.error(state.message);
  }, [state]);
  return (
    <form action={formAction}>
      <input type="hidden" name="id" value={id} />
      <select
        name="status"
        aria-label={label}
        defaultValue={status}
        disabled={pending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs dark:bg-input/30"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {t(`tasks.status.${s}`)}
          </option>
        ))}
      </select>
    </form>
  );
}
