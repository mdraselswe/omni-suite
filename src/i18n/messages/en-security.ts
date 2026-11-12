/** UI and error text for abuse limits, quotas and access hardening. */
export const enSecurity = {
  "security.mailLimitHour":
    "Your business has sent its {limit} emails for this hour. Try again later, or share the link instead.",
  "security.mailLimitDay":
    "Your business has sent its {limit} emails for today. Try again tomorrow, or share the link instead.",
  "security.storageFull":
    "Your business has used its {limit} of file storage ({used} used). Delete old files to upload more.",
  "security.aiMemberLimit": "You have used your {limit} AI requests for today. Try again tomorrow.",
  "security.aiPlanOff": "AI isn't included in your plan. Upgrade in Settings → Subscription to use it.",
  "security.signInThrottled": "Too many sign-in attempts for this email. Wait a few minutes and try again.",
  "security.overrideOwnerOnly": "Only an owner can change an owner's permissions.",
  "security.overrideSelf": "You can't change your own permission overrides.",
  "security.fullBackupOnly":
    "Full backups contain every record, so only an owner (or someone who can export every data set) can download or connect them.",
  "security.uploadTooLarge": "That upload is too large.",
} as const;
