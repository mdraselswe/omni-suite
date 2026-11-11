"use client";

import { Sparkles } from "lucide-react";
import { useId, useRef, useState, useTransition, type ComponentProps } from "react";
import { LineItemsEditor } from "@/components/form/line-items-editor";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { aiConfig } from "@/config/ai";
import { t } from "@/i18n";
import { draftProposalAction } from "./actions";
import { publishDraftItems, useDraftItems } from "./draft-store";

type Status = { kind: "idle" } | { kind: "error"; message: string } | { kind: "done"; items: number };

function setField(form: HTMLFormElement, name: string, value: string) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = value;
}

/**
 * "Draft with AI" box on the proposal form: the member describes the job and the
 * assistant fills title, introduction, terms and line items. Nothing is saved
 * until the member reviews and submits the form.
 */
export function ProposalDraftAssistant({ tenant, scope }: { tenant: string; scope: string }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [brief, setBrief] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function draft() {
    const form = box.current?.closest("form");
    if (!form) return;
    const client = form.elements.namedItem("clientId");
    const clientId =
      client instanceof HTMLInputElement || client instanceof HTMLSelectElement ? client.value : "";
    startTransition(async () => {
      const result = await draftProposalAction(tenant, { brief, clientId: clientId || null });
      if (!result.ok) {
        setStatus({ kind: "error", message: result.message });
        return;
      }
      setField(form, "title", result.data.title);
      setField(form, "intro", result.data.intro);
      setField(form, "terms", result.data.terms);
      if (result.data.items.length > 0) publishDraftItems(scope, result.data.items);
      setStatus({ kind: "done", items: result.data.items.length });
    });
  }

  const tooShort = brief.trim().length < 10;

  return (
    <details className="group rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Sparkles aria-hidden="true" className="size-4 text-primary" />
        {t("ai.draft.title")}
        <span className="text-xs font-normal text-muted-foreground">{t("ai.draft.optional")}</span>
      </summary>
      <div ref={box} className="mt-3 grid gap-3">
        <label htmlFor={`${id}-brief`} className="text-sm text-muted-foreground">
          {t("ai.draft.hint")}
        </label>
        <Textarea
          id={`${id}-brief`}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          maxLength={aiConfig.briefMaxLength}
          rows={4}
          placeholder={t("ai.draft.placeholder")}
          aria-describedby={`${id}-status`}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={draft} disabled={pending || tooShort} aria-busy={pending}>
            <Sparkles aria-hidden="true" />
            {pending ? t("ai.draft.working") : t("ai.draft.run")}
          </Button>
          <p id={`${id}-status`} aria-live="polite" className="text-sm">
            {status.kind === "error" ? (
              <span role="alert" className="text-destructive">
                {status.message}
              </span>
            ) : status.kind === "done" ? (
              <span className="text-muted-foreground">
                {status.items > 0 ? t("ai.draft.done") : t("ai.draft.doneNoItems")}
              </span>
            ) : tooShort ? (
              <span className="text-muted-foreground">{t("ai.draft.tooShort")}</span>
            ) : null}
          </p>
        </div>
      </div>
    </details>
  );
}

/** The line items editor, refilled when the AI draft brings line items. */
export function DraftableLineItems({
  scope,
  initial,
  ...props
}: ComponentProps<typeof LineItemsEditor> & { scope: string }) {
  const draft = useDraftItems(scope);
  return <LineItemsEditor key={draft?.version ?? 0} initial={draft ? draft.items : initial} {...props} />;
}
