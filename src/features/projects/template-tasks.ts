/** A task in a project template, copied into each project made from it. */
export type TemplateTask = { title: string; clientVisible: boolean; needsApproval?: boolean };

/**
 * One template task per line: "Title", "Title | client" (shown in the portal) or
 * "Title | approval" (shown in the portal and approved by the client).
 */
export function parseTemplateTasks(text: string): TemplateTask[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title = "", ...rest] = line.split("|").map((part) => part.trim());
      const flags = new Set(
        rest
          .join(",")
          .split(/[\s,]+/)
          .map((flag) => flag.toLowerCase())
          .filter(Boolean),
      );
      const needsApproval = flags.has("approval") || flags.has("approve");
      return {
        title: title.slice(0, 200),
        clientVisible: needsApproval || flags.has("client"),
        needsApproval,
      };
    })
    .filter((task) => task.title);
}

/** A template task back as its line, for editing. */
export function templateTaskLine(task: TemplateTask): string {
  if (task.needsApproval) return `${task.title} | approval`;
  return task.clientVisible ? `${task.title} | client` : task.title;
}
