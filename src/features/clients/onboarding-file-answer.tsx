"use client";

import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FieldError } from "@/components/form/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";

type ClientFile = { id: string; name: string };

/**
 * A "file" question in the portal questionnaire. Files go through the normal
 * upload route (as the client's own files, so the business sees them in Files
 * too); the answer is the list of ticked files. A file uploaded here is ticked
 * for this question once the page has refreshed. The file input has no name, so
 * the questionnaire form itself never carries file bodies.
 */
export function OnboardingFileAnswer({
  tenant,
  clientId,
  fieldKey,
  label,
  required,
  files,
  canUpload,
}: {
  tenant: string;
  clientId: string;
  fieldKey: string;
  label: string;
  required: boolean;
  files: readonly ClientFile[];
  canUpload: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const name = `a_${fieldKey}`;
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [waitingFor, setWaitingFor] = useState<readonly string[]>([]);
  const [known, setKnown] = useState<ReadonlySet<string>>(() => new Set(files.map((f) => f.id)));
  const [busy, setBusy] = useState(false);

  // After an upload the page refreshes with the new file: tick it for this question.
  const fresh = files.filter((f) => !known.has(f.id));
  if (fresh.length > 0) {
    setKnown(new Set(files.map((f) => f.id)));
    const mine = fresh.filter((f) => waitingFor.includes(f.name));
    if (mine.length > 0) {
      setSelected((prev) => new Set([...prev, ...mine.map((f) => f.id)]));
      setWaitingFor((prev) => prev.filter((n) => !mine.some((f) => f.name === n)));
    }
  }

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function upload() {
    const file = input.current?.files?.[0];
    if (!file) {
      toast.error(t("access.onboarding.pickFile"));
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("entityType", "client");
    body.set("entityId", clientId);
    setBusy(true);
    try {
      const response = await fetch(`/api/t/${encodeURIComponent(tenant)}/files/`, {
        method: "POST",
        body,
        credentials: "same-origin",
      });
      const state = (await response.json()) as { ok?: boolean; message?: string } | null;
      if (!state?.ok) {
        toast.error(state?.message ?? t("form.failed"));
        return;
      }
      toast.success(t("access.onboarding.uploaded", { name: file.name }));
      setWaitingFor((prev) => [...prev, file.name.slice(0, 200) || "file"]);
      if (input.current) input.current.value = "";
      router.refresh();
    } catch {
      toast.error(t("form.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="grid gap-2" aria-describedby={`${name}-error`}>
      <legend className="mb-1 text-sm font-medium">{required ? `${label} *` : label}</legend>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("access.onboarding.noFilesYet")}</p>
      ) : (
        <ul className="grid max-h-56 gap-1.5 overflow-y-auto">
          {files.map((f) => (
            <li key={f.id}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name={name}
                  value={f.id}
                  checked={selected.has(f.id)}
                  onChange={(e) => toggle(f.id, e.target.checked)}
                  className="size-4 shrink-0 rounded border-input accent-primary"
                />
                <span className="min-w-0 break-all">{f.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {canUpload ? (
        <div className="grid gap-1.5">
          <label htmlFor={`${name}-upload`} className="text-xs text-muted-foreground">
            {t("access.onboarding.addFile")}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id={`${name}-upload`} ref={input} type="file" className="min-w-0 flex-1" />
            <Button type="button" variant="outline" onClick={upload} disabled={busy} aria-busy={busy}>
              <Upload aria-hidden="true" />
              {busy ? t("access.onboarding.uploading") : t("files.upload")}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("access.onboarding.noFileAccess")}</p>
      )}
      <FieldError name={name} />
    </fieldset>
  );
}
