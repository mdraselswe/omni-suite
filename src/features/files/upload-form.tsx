"use client";

import { useRouter } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";
import { ActionForm, type FormState } from "@/components/form/action-form";
import { FormDialog } from "@/components/form/form-dialog";
import { t } from "@/i18n";

/** Posts the form to the upload route (large bodies are allowed there, not on Server Actions). */
async function postUpload(tenant: string, formData: FormData): Promise<FormState> {
  try {
    const response = await fetch(`/api/t/${encodeURIComponent(tenant)}/files/`, {
      method: "POST",
      body: formData,
      credentials: "same-origin",
    });
    const state = (await response.json()) as FormState;
    return state ?? { ok: false, message: t("form.failed") };
  } catch {
    return { ok: false, message: t("form.failed") };
  }
}

/** A form action that uploads through the route and refreshes the page on success. */
function useUploadAction(tenant: string) {
  const router = useRouter();
  return async (_state: FormState, formData: FormData): Promise<FormState> => {
    const state = await postUpload(tenant, formData);
    if (state?.ok) router.refresh();
    return state;
  };
}

/** Upload dialog (same fields as before: file, target, visibility). */
export function UploadFileDialog({
  tenant,
  children,
  ...dialog
}: { tenant: string; children: ReactNode } & Omit<ComponentProps<typeof FormDialog>, "action" | "children">) {
  const upload = useUploadAction(tenant);
  return (
    <FormDialog {...dialog} action={upload}>
      {children}
    </FormDialog>
  );
}

/** Inline upload form (client portal). */
export function UploadFileForm({
  tenant,
  children,
  className,
}: {
  tenant: string;
  children: ReactNode;
  className?: string;
}) {
  const upload = useUploadAction(tenant);
  return (
    <ActionForm action={upload} className={className}>
      {children}
    </ActionForm>
  );
}
