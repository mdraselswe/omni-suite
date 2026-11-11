/**
 * Demo accounts created by `pnpm db:seed` for local testing (sample data only).
 * The quick sign-in buttons appear only when DEV_LOGIN=true outside production.
 */
export const DEMO_PASSWORD = "omnisuite-demo-2026";

export const DEMO_ACCOUNTS = [
  { email: "owner@demo.test", name: "Ayesha Rahman", label: "Owner (partner A)" },
  { email: "partner@demo.test", name: "Tanvir Hasan", label: "Partner B" },
  { email: "manager@demo.test", name: "Nadia Islam", label: "Manager" },
  { email: "staff@demo.test", name: "Rafi Ahmed", label: "Staff" },
  { email: "accountant@demo.test", name: "Sarah Mitchell", label: "Accountant" },
  { email: "client@demo.test", name: "Jack Wilson", label: "Client" },
] as const;
