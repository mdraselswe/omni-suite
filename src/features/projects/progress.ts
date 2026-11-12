/** Done and total tasks; `list` is what the viewer may see (client users: client-visible only). */
export function taskProgress(list: readonly { status: string }[]) {
  const total = list.length;
  const done = list.filter((task) => task.status === "done").length;
  return { done, total, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}
