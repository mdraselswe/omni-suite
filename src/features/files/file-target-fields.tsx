"use client";

import { useState } from "react";
import { SelectField } from "@/components/form/field";
import { t } from "@/i18n";

type Option = { value: string; label: string };

/** "Attach to" picker: general, or a specific client or project (sends entityType + entityId). */
export function FileTargetFields({
  clients,
  projects,
}: {
  clients: readonly Option[];
  projects: readonly Option[];
}) {
  const [type, setType] = useState<"general" | "client" | "project">("general");
  const types: Option[] = [
    { value: "general", label: t("files.entity.general") },
    ...(clients.length ? [{ value: "client", label: t("files.entity.client") }] : []),
    ...(projects.length ? [{ value: "project", label: t("files.entity.project") }] : []),
  ];
  return (
    <>
      <SelectField
        name="entityType"
        label={t("files.attachTo")}
        options={types}
        value={type}
        onChange={(e) => {
          const v = e.target.value;
          setType(v === "client" || v === "project" ? v : "general");
        }}
      />
      {type === "client" ? (
        <SelectField
          name="entityId"
          label={t("files.client")}
          options={clients}
          hint={t("files.entityHint")}
        />
      ) : null}
      {type === "project" ? (
        <SelectField
          name="entityId"
          label={t("files.project")}
          options={projects}
          hint={t("files.entityHint")}
        />
      ) : null}
    </>
  );
}
