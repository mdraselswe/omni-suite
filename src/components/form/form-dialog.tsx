"use client";

import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { ActionForm, SubmitButton, type FormState } from "./action-form";

/** A button that opens a dialog with a Server Action form; closes on success. */
export function FormDialog({
  trigger,
  title,
  description,
  action,
  submitLabel,
  children,
  variant = "default",
  size = "default",
  icon = true,
  wide = false,
}: {
  trigger: string;
  title: string;
  description?: string;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel?: string;
  children: ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  icon?: boolean;
  wide?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant={variant} size={size} />}>
        {icon ? <Plus aria-hidden="true" /> : null}
        {trigger}
      </DialogTrigger>
      <DialogContent
        className={wide ? "max-h-[90svh] overflow-y-auto sm:max-w-2xl" : "max-h-[90svh] overflow-y-auto"}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <ActionForm action={action} onSuccess={() => setOpen(false)}>
          {children}
          <SubmitButton pendingLabel={t("form.saving")}>{submitLabel ?? t("form.save")}</SubmitButton>
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
