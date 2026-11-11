"use client";

import { useState } from "react";
import { SelectField } from "@/components/form/field";
import { t } from "@/i18n";

/** Picks where an uploaded file belongs: the client itself or one of its projects. */
export function UploadTarget({
  clientId,
  projects,
}: {
  clientId: string;
  projects: readonly { value: string; label: string }[];
}) {
  const [target, setTarget] = useState(clientId);
  const isProject = target !== clientId;
  return (
    <>
      <input type="hidden" name="entityType" value={isProject ? "project" : "client"} />
      <SelectField
        name="entityId"
        label={t("portal.project")}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        options={[{ value: clientId, label: t("portal.noProject") }, ...projects]}
      />
    </>
  );
}
