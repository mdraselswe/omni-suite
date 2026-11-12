/** UI text for getting clients and team members in: invitations, first sign-in, onboarding forms. */
export const enPortalAccess = {
  // Invitation emails
  "access.mail.client.subject": "{inviter} invited you to the {business} client portal",
  "access.mail.client.body":
    "Hello,\n\n{inviter} at {business} invited you to their client portal on {app}. It's where you follow your projects, answer questions, approve work, see invoices and share files with {business}.\n\nSet up your access (it takes a minute, no separate sign-up needed):\n{link}\n\nThe link is for {email} only and works for {days} days. If you weren't expecting this, you can ignore this email.",
  "access.mail.team.subject": "{inviter} invited you to join {business} on {app}",
  "access.mail.team.body":
    "Hello,\n\n{inviter} invited you to join the {business} team on {app}.\n\nSet up your access (it takes a minute, no separate sign-up needed):\n{link}\n\nThe link is for {email} only and works for {days} days. If you weren't expecting this, you can ignore this email.",

  // Invitation page
  "access.invite.heading": "{inviter} invited you to {business}",
  "access.invite.purposeClient":
    "Your client portal with {business}: follow your projects, answer questions, approve work, see invoices and share files, all in one place.",
  "access.invite.purposeTeam": "You'll join the {business} team on {app}.",
  "access.invite.forEmail": "This invitation is for {email} and works for {days} more day(s).",
  "access.invite.createTitle": "Set up your access",
  "access.invite.yourName": "Your name",
  "access.invite.emailFixed": "Invitations are tied to the address they were sent to.",
  "access.invite.password": "Choose a password",
  "access.invite.passwordHint": "At least {min} characters. You'll use it with this email to sign in.",
  "access.invite.confirmPassword": "Repeat the password",
  "access.invite.passwordTooLong": "Use at most 128 characters.",
  "access.invite.confirmFirst":
    "This link was shared with you directly, so we'll first email {email} a confirmation link. Opening it brings you back here.",
  "access.invite.join": "Join {business}",
  "access.invite.joining": "Setting up…",
  "access.invite.checkInboxTitle": "Check your inbox",
  "access.invite.checkInbox":
    "We sent a confirmation link to {email}. Open it on this device and you'll come back here, signed in, to finish joining.",
  "access.invite.noMail": "No email after a few minutes? Check spam, or",
  "access.invite.resendConfirmation": "sign in to get a new confirmation link",
  "access.invite.haveAccount": "You already have an account with {email}. Sign in to accept the invitation.",
  "access.invite.unconfirmedAccount":
    "That account's email isn't confirmed yet. Sign in and we'll email you a confirmation link, or reset your password.",
  "access.invite.signInToJoin": "Sign in to accept",
  "access.invite.orGoogle": "Use Google with this email address?",
  "access.invite.useGoogle": "Sign in with Google",
  "access.invite.googleOnly": "Sign in with the Google account for {email} to accept the invitation.",
  "access.invite.otherAccountTitle": "You're signed in with a different account",
  "access.invite.otherAccount":
    "You're signed in as {current}, but this invitation is for {email}. Sign out, then open the invitation link again to continue as {email}.",
  "access.invite.signOutFirst": "You're already signed in. Sign out first, then set up the invited account.",
  "access.invite.accountExists": "An account for {email} already exists. Sign in to accept the invitation.",
  "access.invite.signupFailed":
    "We couldn't set up your account. Please try again, or sign in if you already have one.",
  "access.invite.appHostOnly": "Open the invitation link from the email to continue.",
  "access.invite.goHome": "Go to your dashboard",
  "access.invite.open": "Open {business}",
  "access.invite.title.accepted": "Invitation already used",
  "access.invite.title.expired": "Invitation expired",
  "access.invite.title.revoked": "Invitation withdrawn",
  "access.invite.state.missing":
    "This invitation link isn't valid. Check that you opened the whole link from the email, or ask whoever invited you to send it again.",
  "access.invite.state.accepted":
    "This invitation has already been accepted. Sign in with the invited email address to open {business}.",
  "access.invite.state.expired":
    "This invitation has expired. Ask {business} to send it again; the new email has a fresh link.",
  "access.invite.state.revoked":
    "{business} withdrew this invitation. If you still need access, ask them to invite you again.",

  // Pending invitations (team page and client page)
  "access.team.invitationsSub":
    "Invitations not yet accepted. Resend sends a fresh link; the old one stops working.",
  "access.invite.sentOn": "Sent {date}",
  "access.invite.sentBy": "Sent {date} by {name}",
  "access.invite.expiredOn": "Expired {date}",
  "access.invite.expiredBadge": "Expired",
  "access.invite.linkHint":
    "Shared by hand, the link still asks the person to confirm their email. The emailed link doesn't.",
  "access.invite.resend": "Resend",
  "access.invite.resendConfirm": "Email {email} a new invitation link? The current link stops working.",
  "access.invite.resent": "Invitation sent again with a new link.",
  "access.invite.revokeConfirm": "Withdraw the invitation for {email}? The link stops working.",
  "access.invite.revoked": "Invitation withdrawn.",
  "access.invite.notPending": "This invitation was already accepted or withdrawn.",
  "access.invite.alreadyInvited":
    "{email} already has a pending invitation. Resend it from the pending invitations list instead.",
  "access.notify.accepted": "{name} accepted your invitation",
  "access.client.inviteHint":
    "They get an email from you with a link to set up their access. They only see this client's portal.",
  "access.client.onlyInvited": "No one from this client has joined yet. Their invitation is still pending.",

  // Home and new business
  "access.home.invitations": "Your invitations",
  "access.home.view": "View invitation",
  "access.home.expired": "This invitation expired. Ask {business} to send it again.",
  "access.home.disabled": "Your access to {business} is switched off. Contact them if you need it back.",
  "access.home.noAccessTitle": "No access yet",
  "access.home.orCreate": "Running your own business? You can set it up here.",
  "access.onboardingPage.invited":
    "You've been invited to {business}. Accept that first if that's why you're here.",
  "access.onboardingPage.client":
    "You already have client portal access to {business}. You don't need a business of your own to use it.",
  "access.onboardingPage.openPortal": "Open the portal",

  // Onboarding forms
  "access.onboarding.questionsHint":
    "One per line: Question | type | required. Types: text, textarea, select: Option A, Option B (choices separated by commas), file (the client uploads files). Example: What's your budget? | select: Under 1k, 1k–5k, Over 5k | required",
  "access.onboarding.type.text": "Short answer",
  "access.onboarding.type.textarea": "Long answer",
  "access.onboarding.type.select": "Choice",
  "access.onboarding.type.file": "File upload",
  "access.onboarding.selectNeedsOptions":
    'Add the choices for "{field}" after select:, separated by commas (select: Option A, Option B).',
  "access.onboarding.choose": "Choose…",
  "access.onboarding.invalidChoice": "Pick one of the listed answers for: {field}",
  "access.onboarding.fileMissing":
    'One of the files chosen for "{field}" is no longer available. Pick it again.',
  "access.onboarding.fileGone": "File removed",
  "access.onboarding.noFilesYet": "No files uploaded yet.",
  "access.onboarding.addFile": "Upload a file for this question",
  "access.onboarding.pickFile": "Choose a file first.",
  "access.onboarding.uploading": "Uploading…",
  "access.onboarding.uploaded": "{name} uploaded. It's ticked for this question.",
  "access.onboarding.noFileAccess":
    "You can't upload files here. Ask your contact to share file access with you.",
  "access.onboarding.noPortalUser":
    "No one from {client} can sign in to the portal yet, so nobody could fill in the form. Invite a portal user first, or let this form invite them.",
  "access.onboarding.noOneMayAnswer":
    "No one from {client} can fill in onboarding forms (it needs the Client owner role). Invite someone with that role, or let this form invite them.",
  "access.onboarding.waitingForInvite":
    "Nobody from {client} has joined the portal yet. {count} pending invitation(s) will let them fill in onboarding forms once accepted.",
  "access.onboarding.inviteToo": "Also invite this person to the portal",
  "access.onboarding.inviteTooHint": "They get an invitation email and find the form when they sign in.",
  "access.onboarding.askInviter":
    "Ask someone who can invite people to invite a portal user for this client first.",
  "access.onboarding.cantInvite": "You can't invite portal users. Ask someone who can, then send the form.",
  "access.onboarding.noRole":
    "No client role can fill in onboarding forms. Give one the onboarding permission first.",
  "access.onboarding.sent.portal": "Form sent. The client's portal users were notified by email.",
  "access.onboarding.sent.pendingInvite":
    "Form sent. Nobody has joined the portal yet; they'll see it once they accept their invitation.",
  "access.onboarding.sent.invited": "Form sent, and {email} was invited to the portal to fill it in.",
} as const;
