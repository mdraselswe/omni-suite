# OmniSuite লোকালি চালানো ও টেস্ট করার গাইড

এই গাইড ধাপে ধাপে দেখায় কীভাবে নিজের কম্পিউটারে OmniSuite চালিয়ে সব ফিচার টেস্ট করবেন। ডেমো ডেটা সব নমুনা (sample), আসল কোনো ব্যক্তি বা টাকার তথ্য নেই।

## ১. যা লাগবে

- Node 24 বা 26 (`node -v`), pnpm (`corepack enable`)
- Docker Desktop (Postgres আর Mailpit চালানোর জন্য)

## ২. প্রথমবার সেটআপ

```bash
pnpm install
```

```bash
docker compose up -d
```

`.env.local` ফাইল না থাকলে `.env.example` কপি করে `.env.local` বানান। এরপর `BETTER_AUTH_SECRET` আর `ENCRYPTION_KEY`-এ random মান দিন। নিচের কমান্ডটা দুইবার চালিয়ে দুইটা মান নিন:

```bash
node -e "console.log(crypto.randomBytes(32).toString('base64'))"
```

তারপর ডেটাবেস তৈরি করে ডেমো ডেটা ঢোকান:

```bash
pnpm db:seed
```

## ৩. চালানো

```bash
pnpm dev
```

ব্রাউজারে খুলুন: http://localhost:3000। Login পেজে **Demo accounts** বাটন আছে, এক ক্লিকে যেকোনো role হিসেবে ঢোকা যায়। সব ডেমো অ্যাকাউন্টের পাসওয়ার্ড `omnisuite-demo-2026`।

| অ্যাকাউন্ট             | Role                  | কী দেখবেন                                            |
| ---------------------- | --------------------- | ---------------------------------------------------- |
| `owner@demo.test`      | Owner (Partner A)     | সবকিছু: টাকা, পার্টনার, প্রফিট, টিম, সেটিংস          |
| `partner@demo.test`    | Owner (Partner B)     | প্রফিট রুল অনুমোদন, পার্টনার স্টেটমেন্ট              |
| `manager@demo.test`    | Manager               | লিড, ক্লায়েন্ট, প্রজেক্ট, ইনভয়েস (টাকার হিসাব না)  |
| `staff@demo.test`      | Staff                 | শুধু নিজের প্রজেক্ট, টাস্ক আর সময়                   |
| `accountant@demo.test` | Accountant            | টাকা, রিপোর্ট, পেমেন্ট, অ্যাক্টিভিটি লগ              |
| `client@demo.test`     | Client (Harbour Cafe) | ক্লায়েন্ট পোর্টাল: প্রজেক্ট, অনুমোদন, ইনভয়েস, ফাইল |

ইমেইল (ইনভাইট, নোটিফিকেশন) যায় Mailpit-এ: http://localhost:8025

## ৪. যা যা টেস্ট করবেন (চেকলিস্ট)

1. **ড্যাশবোর্ড** (owner): ক্যাশ, MRR, পাওনা, এই মাস/অর্থবছরের প্রফিট, runway, ৬ মাসের আয়-ব্যয় চার্ট।
2. **Money**: একটা খরচ (expense) যোগ করুন, তারপর Reverse করে দেখুন ব্যালেন্স ঠিক হয় কিনা। Report-এ P&L, GST আর CSV ডাউনলোড। Setup-এ মাস Close করলে ওই মাসে আর এন্ট্রি হবে না।
3. **Partners**: ক্যাপিটাল ৩০,০০০ / ২০,০০০, মালিকানা ৬০/৪০। Dilution calculator-এ নতুন পার্টনারের বিনিয়োগ দিয়ে হিসাব দেখুন। Rules-এ নতুন রুল প্রস্তাব করুন (যেমন fixed 50/50); partner@demo.test দিয়ে ঢুকে অনুমোদন দিন, তারপর রুলটা active হবে। Distributions-এ একটা পিরিয়ড বেছে প্রফিট ভাগ দেখুন।
4. **Leads**: স্টেজ বদলান, একটা লিডকে ক্লায়েন্টে convert করুন।
5. **Clients**: নতুন ক্লায়েন্ট, CSV import, অনবোর্ডিং ফর্ম পাঠানো, পোর্টাল ইউজার ইনভাইট।
6. **Proposals → Invoices**: প্রপোজাল পাঠান, client@demo.test দিয়ে (Harbour Cafe-এর প্রপোজাল হলে) accept করুন, তারপর invoice বানান। ইনভয়েস Send, পেমেন্ট রেকর্ড, Print view। Recurring-এ মাসিক retainer।
7. **Projects/Time**: staff@demo.test দিয়ে শুধু নিজের প্রজেক্ট দেখা যায় কিনা, সময় লগ, টাস্কের স্ট্যাটাস। Owner দিয়ে প্রজেক্টের cost বনাম budget।
8. **Client portal**: client@demo.test দিয়ে "New winter menu page" টাস্ক Approve করুন, কমেন্ট দিন, ফাইল আপলোড করুন।
9. **Team & roles**: একজনকে ইনভাইট (Mailpit-এ লিংক), role-এর permission বদলানো, একজন মেম্বারকে আলাদা করে একটা permission allow/deny (মেয়াদসহ)। Owner role বদলানো যায় না, শেষ owner-কে সরানো যায় না।
10. **Settings**: GST, ইনভয়েস prefix, মডিউল on/off (যেমন Leads বন্ধ করলে মেনু থেকে চলে যায়), custom field যোগ (ক্লায়েন্ট ফর্মে দেখাবে), pipeline stage বদলানো।
11. **Activity log**: উপরের সব পরিবর্তন সেখানে দেখা যাবে।
12. **Platform admin** (`/admin`): `.env.local`-এর `PLATFORM_ADMIN_EMAILS`-এর ইমেইল দিয়ে Google-এ ঢুকলে দেখা যাবে (Google সেটআপের পরে)।

## ৫. Google সেটআপের পরে যা টেস্ট করবেন

Google Cloud-এ OAuth client বানানোর পরে `GOOGLE_CLIENT_ID` আর `GOOGLE_CLIENT_SECRET` শুধু `.env.local`-এ বসান। এগুলো কখনো চ্যাটে বা git-এ দেবেন না। Redirect URI দুইটা:

- `http://localhost:3000/api/auth/callback/google`
- `http://localhost:3000/api/google/callback`

Google Drive API আর Google Sheets API চালু করুন। তারপর:

- Login পেজে **Continue with Google**।
- Settings → Backup → **Connect Google Drive**। এক মিনিটের মধ্যে Drive-এ "OmniSuite backup" ফোল্ডার আর একটা স্প্রেডশিট তৈরি হবে। প্রতিটা পরিবর্তন শিটে কপি হবে, আর রাতে একটা JSON snapshot যাবে।

## ৬. অটোমেটেড টেস্ট

```bash
pnpm test
```

```bash
pnpm check
```

E2E (Playwright + accessibility): প্রথমে `pnpm build`, তারপর `pnpm test:e2e`। এর জন্য Postgres চালু থাকতে হবে আর `pnpm db:seed` করা থাকতে হবে।

## ৭. সমস্যা হলে

- "migration failed / Is Postgres running?" দেখালে `docker compose up -d` চালান।
- ডেমো ডেটা একদম নতুন করে চাইলে প্রথমে `docker compose down -v`, তারপর `docker compose up -d`, তারপর `pnpm db:seed`।
- পুরনো service worker পুরনো পেজ দেখালে ব্রাউজারে hard reload (Ctrl+Shift+R) করুন।
