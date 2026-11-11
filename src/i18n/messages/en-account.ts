/** UI text for account, sign-in, team and settings (added in the project review). */
export const enAccount = {
  // Account page and user menu
  "account.menu": "Your account",
  "account.title": "Your account",
  "account.sub": "Signed in as {email}. These details are the same in every business you belong to.",
  "account.back": "Back to your businesses",
  "account.profile": "Profile",
  "account.profileSaved": "Profile saved.",
  "account.emailFixed": "Your email address can't be changed here.",
  "account.password": "Password",
  "account.currentPassword": "Current password",
  "account.newPassword": "New password",
  "account.confirmPassword": "Repeat the new password",
  "account.passwordHint": "At least {min} characters.",
  "account.changePassword": "Change password",
  "account.passwordChanged": "Password changed. Other devices were signed out.",
  "account.passwordFailed": "The password couldn't be changed. Please try again.",
  "account.wrongPassword": "Your current password isn't right.",
  "account.passwordTooShort": "Use at least {min} characters.",
  "account.passwordMismatch": "The two passwords don't match.",
  "account.noPassword": "This account signs in without a password.",
  "account.noPasswordHint": "You sign in with Google, so there is no password to change.",
  "account.createPassword": "Create a password",
  "account.boundSession": "Manage your account on the main app address.",

  // Email verification
  "account.checkEmail": "We sent a confirmation link to {email}. Open it to finish signing in.",
  "account.verifyFirst": "Please confirm your email address first. We've sent you a new link.",

  // Password reset
  "account.forgotPassword": "Forgot password?",
  "account.resetTitle": "Reset your password",
  "account.resetSub": "Enter your email address and we'll send you a link to choose a new password.",
  "account.sendResetLink": "Send reset link",
  "account.resetSent":
    "If an account exists for that address, a reset link is on its way. It works for one hour.",
  "account.newPasswordTitle": "Choose a new password",
  "account.newPasswordSub": "You'll be signed out on other devices once it's saved.",
  "account.setPassword": "Save new password",
  "account.resetDone": "Your password has been changed. You can sign in with it now.",
  "account.resetInvalid": "This reset link is invalid or has expired. Ask for a new one below.",
  "account.passwordsOff": "Password sign-in isn't switched on. Use the sign-in options on the sign-in page.",
  "account.tooManyRequests": "Too many attempts. Please wait a minute and try again.",
  "account.backToSignIn": "Back to sign in",

  // Emails sent by sign-in
  "account.mail.verifySubject": "Confirm your email address for {app}",
  "account.mail.verifyBody":
    "Hi {name},\n\nConfirm your email address to finish setting up your {app} account:\n{link}\n\nIf you didn't create an account, you can ignore this email.",
  "account.mail.resetSubject": "Reset your {app} password",
  "account.mail.resetBody":
    "Hi {name},\n\nUse this link to choose a new {app} password (it works for one hour):\n{link}\n\nIf you didn't ask for this, you can ignore this email; your password stays the same.",

  // Billing banner (tenant layout)
  "account.fixPayment": "Update payment",

  // Custom-domain sign-in confirmation
  "handoff.title": "Continue to {name}",
  "handoff.body": "{name} uses its own web address, {host}. You're signed in as {email}.",
  "handoff.continue": "Continue to {host}",
  "handoff.cancel": "Not now",
  "handoff.invalidTitle": "This address isn't available",
  "handoff.invalid": "{host} isn't connected to a business here.",
  "handoff.notMemberTitle": "No access to this business",
  "handoff.notMember":
    "{email} isn't a member of the business at {host}. Ask its owner for an invitation, or sign in with another account.",

  // Invitations
  "invite.mail.subject": "{inviter} invited you to {name} on {app}",
  "invite.mail.body":
    "{inviter} invited you to {name} on {app}.\n\nAccept the invitation: {link}\n\nThe link expires in {days} days.",
  "invite.verifyEmail":
    "Confirm your email address {email} first (check your inbox for the link), then accept the invitation.",

  // Team
  "team.ownerOnly": "Only an owner can switch an owner off or back on.",
  "team.linkCopied": "Link copied",
  "team.copyFailed": "Couldn't copy. Select the link and copy it instead.",

  // Settings: custom fields and pipeline
  "settings.fieldMissing": "Field not found.",
  "settings.editField": "Edit {label}",
  "settings.editFieldSub": "The field's type stays the same, so values already saved keep working.",
  "settings.moveUp": "Move {label} up",
  "settings.moveDown": "Move {label} down",
  "settings.stageInUse":
    '{count} lead(s) are still in the stage "{key}". Move them to another stage before removing it.',
  "settings.statusInUse": '{count} project(s) still have the status "{key}". Change them before removing it.',
  "settings.keysInUseHint": "A stage or status still used by a lead or project can't be removed.",

  // Settings: domains
  "domains.alreadyAdded": "This business has already added that domain.",
  "domains.claimPending":
    "Another business has started adding this domain but hasn't proved ownership. If it's yours, add a TXT record named {name} with the value {value}, then add the domain again.",
} as const;
