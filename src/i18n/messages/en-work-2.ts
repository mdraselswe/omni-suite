/** UI text for leads, clients, projects, time and files (added in the project review). */
export const enWork2 = {
  "list.loadMore": "Show more",

  "leads.otherStage": "Other stage",
  "leads.otherStageHint":
    "These leads are in a stage that is no longer in the pipeline. Move them to a current stage.",
  "leads.unknownStage": "Unknown stage: {stage}",
  "leads.badOwner": "Choose an owner from your team.",
  "leads.archive": "Archive",
  "leads.unarchive": "Restore",
  "leads.archived": "Archived",
  "leads.showArchived": "Show archived ({count})",
  "leads.hideArchived": "Hide archived",
  "leads.archiveConfirm": "Archive this lead? It leaves the board but stays in your records.",

  "projects.noClient": "Link the project to a client before invoicing its time.",
  "projects.nothingToInvoice": "There is no unbilled billable time on this project.",
  "projects.invoiceTime": "Invoice unbilled time",
  "projects.invoiceTimeConfirm": "Create a draft invoice for {time} of unbilled time ({value})?",
  "projects.unbilled": "Unbilled time",
  "projects.unbilledHint": "{time} · {value}",
  "projects.timeInvoiceLine": "{member}: time on {project} (hours)",
  "projects.timeInvoiceNotes": "Time on {project}",
  "projects.templateDeleted": "Template deleted.",
  "projects.deleteTemplateConfirm":
    "Delete this template? Projects already created from it keep their tasks.",

  "tasks.badAssignee": "Choose an assignee from your team.",
  "tasks.requestChanges": "Request changes",
  "tasks.requestChangesSub": "Tell the team what needs to change. The task goes back to in progress.",
  "tasks.changesLabel": "What needs to change?",
  "tasks.changesTitle": "Changes requested: {title}",
  "tasks.changesComment": "Changes requested on “{title}”: {comment}",
  "tasks.changesSent": "Sent to the team.",
  "tasks.notInReview": "This task is not waiting for review.",

  "time.badMember": "Choose a person from your team.",
  "time.badTask": "That task is not on this project.",
  "time.billed": "Billed",
  "time.unbilled": "Not billed",
  "time.alreadyBilled": "This time is on an invoice, so it can't be deleted.",

  "files.badTarget": "You can't add files there.",
  "files.clientUploadedTitle": "New file from a client: {name} ({target})",

  "clients.importSummary": "Imported {imported} clients, skipped {skipped}.",
  "clients.importSkippedRows": "Skipped rows: {rows}.",
  "clients.importHintCustom":
    "Columns: name, email, phone, website, address, notes, and cf_<key> for custom fields. First row is the header; rows that don't pass the checks are skipped and listed.",

  "onboarding.templateInUse": "This form has been sent to clients, so it can't be deleted.",
  "onboarding.templateDeleted": "Form deleted.",
  "onboarding.deleteTemplateConfirm": "Delete this form?",
} as const;
