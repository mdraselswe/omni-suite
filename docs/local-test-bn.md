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

| অ্যাকাউন্ট              | Role                              | কী দেখবেন                                                  |
| ----------------------- | --------------------------------- | ---------------------------------------------------------- |
| `owner@demo.test`       | Owner (Partner A)                 | সবকিছু: টাকা, পার্টনার, প্রফিট, টিম, সেটিংস                |
| `partner@demo.test`     | Owner (Partner B)                 | প্রফিট রুল অনুমোদন, পার্টনার স্টেটমেন্ট                    |
| `manager@demo.test`     | Manager                           | লিড, ক্লায়েন্ট, প্রজেক্ট, ইনভয়েস (টাকার হিসাব না)        |
| `staff@demo.test`       | Staff                             | শুধু নিজের প্রজেক্ট, টাস্ক আর সময়                         |
| `accountant@demo.test`  | Accountant                        | টাকা, রিপোর্ট, পেমেন্ট, অ্যাক্টিভিটি লগ                    |
| `client@demo.test`      | Client (Harbour Cafe)             | ক্লায়েন্ট পোর্টাল: প্রজেক্ট, অনুমোদন, ইনভয়েস, ফাইল       |
| `clientstaff@demo.test` | Client team member (Harbour Cafe) | পোর্টালে শুধু কাজ আর ফাইল; টাকা, প্রপোজাল, অনুমোদন দেখে না |

ইমেইল (ইনভাইট, নোটিফিকেশন) যায় Mailpit-এ: http://localhost:8025

### ডেমো ডেটায় কী কী আছে (যাতে প্রতিটা অবস্থা চোখে পড়ে)

- **টাকা কোথায়**: AUD ব্যবসার ব্যাংক, ঢাকা অফিসের BDT অ্যাকাউন্ট (প্রতি মাসে Wise দিয়ে টাকা যায়, তারপর বেতন আর ভাড়া টাকায়), আর USD কার্ড (Figma/GitHub; পরের মাসে ব্যাংক থেকে শোধ, তাই এই মাসের চার্জটা কার্ডে বাকি দেখায়)। সফটওয়্যার আর বিজ্ঞাপনে GST আছে, ফ্রিল্যান্সারে নেই। একটা খরচ ভুলে দুবার এন্ট্রি হয়েছিল, পরে Reverse করা।
- **ইনভয়েসের সব অবস্থা**: ক্যাফে (৫ মাস) আর জিম (৭ মাস)-এর retainer সব paid; ওয়েবসাইট প্রজেক্টের deposit আংশিক paid; ক্যাফের এই মাসের বিল sent; একটা ইনভয়েস ৩ সপ্তাহ overdue (Aged receivables-এ দেখায়); একটা ভুলে দুবার করা ইনভয়েস void; জিমের ঘণ্টাভিত্তিক বিজ্ঞাপনের কাজের অর্ধেক সময় ইনভয়েস হয়েছে, বাকিটা unbilled।
- **ক্রেডিট নোট**: Coastal Plumbing-এর ওয়েবসাইট ইনভয়েসে CN-0001 ($300), কারণসহ। পাওনা ততটা কমেছে।
- **সাপ্লায়ার বিল** (Bills): হোস্টিং পুরো paid, ডিজাইনারের বিল অর্ধেক paid, অ্যাকাউন্ট্যান্টের বিল overdue।
- **শেয়ার লিংক**: জিমের পোর্টাল লগইন নেই, তাই ওদের ইনভয়েস ইমেইলে একটা লিংক যায় (Mailpit-এ দেখুন)। ক্যাফের overdue ইনভয়েসের পেজে "Share link" অংশে লিংকটা আছে।
- **প্রপোজাল**: একটা accepted (ওয়েবসাইট), একটা অপেক্ষায়, একটা কারণসহ declined, একটা মেয়াদ পেরিয়ে **Expired** (স্টাফ মেয়াদ বাড়াতে পারে)।
- **অনবোর্ডিং**: ক্যাফে পোর্টালে ফর্ম পূরণ করেছে (টিম এখন চেকলিস্ট করবে); জিমের কোনো পোর্টাল লগইন নেই, তাই ফর্মটা Jordan-কে ইনভাইটসহ গেছে (Mailpit-এ দেখুন)।
- **লিড**: ৮টা, উৎস আর দায়িত্বপ্রাপ্ত মানুষসহ; কয়েকটার follow-up আজ বা পেরিয়ে গেছে (Leads-এ "Follow-ups due"); একটা won হয়ে ক্লায়েন্ট হয়েছে, একটা lost, একটা spam archived।
- **পার্টনার**: গত কোয়ার্টারের প্রফিট ভাগ final, দুই পার্টনার drawing নিয়েছে, আর ৪ মাস আগের সব মাস close করা (ওই মাসে আর কিছু বদলানো যায় না)।

## ৪. যা যা টেস্ট করবেন (চেকলিস্ট)

1. **ড্যাশবোর্ড** (owner): ক্যাশ, MRR, পাওনা, এই মাস/অর্থবছরের প্রফিট, runway, ৬ মাসের আয়-ব্যয় চার্ট।
2. **Money**: একটা খরচ (expense) যোগ করুন, তারপর Reverse করে দেখুন ব্যালেন্স ঠিক হয় কিনা। Report-এ P&L, GST আর CSV ডাউনলোড। Setup-এ মাস Close করলে ওই মাসে আর এন্ট্রি হবে না।
3. **Partners**: ক্যাপিটাল ৩০,০০০ / ২০,০০০, মালিকানা ৬০/৪০। Dilution calculator-এ নতুন পার্টনারের বিনিয়োগ দিয়ে হিসাব দেখুন। Rules-এ নতুন রুল প্রস্তাব করুন (যেমন fixed 50/50); partner@demo.test দিয়ে ঢুকে অনুমোদন দিন, তারপর রুলটা active হবে। Distributions-এ একটা পিরিয়ড বেছে প্রফিট ভাগ দেখুন।
4. **Leads**: স্টেজ বদলান, একটা লিডকে ক্লায়েন্টে convert করুন।
5. **Clients**: নতুন ক্লায়েন্ট, CSV import, অনবোর্ডিং ফর্ম পাঠানো, পোর্টাল ইউজার ইনভাইট।
6. **Proposals → Invoices**: প্রপোজাল পাঠান, client@demo.test দিয়ে (Harbour Cafe-এর প্রপোজাল হলে) accept করুন, তারপর invoice বানান। ইনভয়েস Send, পেমেন্ট রেকর্ড, Print view। Recurring-এ মাসিক retainer।
7. **Projects/Time**: staff@demo.test দিয়ে শুধু নিজের প্রজেক্ট দেখা যায় কিনা, সময় লগ, টাস্কের স্ট্যাটাস। Owner দিয়ে প্রজেক্টের cost বনাম budget।
8. **Client portal**: client@demo.test দিয়ে "New winter menu page" টাস্ক Approve করুন, কমেন্ট দিন, ফাইল আপলোড করুন। Invoices-এ Statement আর overdue বিল, Proposals-এ Expired/Declined দেখুন। তারপর clientstaff@demo.test দিয়ে ঢুকে দেখুন টাকার কিছু দেখা যায় না।
9. **Team & roles**: একজনকে ইনভাইট (Mailpit-এ লিংক), role-এর permission বদলানো, একজন মেম্বারকে আলাদা করে একটা permission allow/deny (মেয়াদসহ)। Owner role বদলানো যায় না, শেষ owner-কে সরানো যায় না।
10. **Settings**: GST, ইনভয়েস prefix, মডিউল on/off (যেমন Leads বন্ধ করলে মেনু থেকে চলে যায়), custom field যোগ (ক্লায়েন্ট ফর্মে দেখাবে), pipeline stage বদলানো।
11. **Credit note**: owner দিয়ে একটা sent বা paid ইনভয়েসে **Issue credit note**। পাওনার চেয়ে বেশি দিলে বাড়তি অংশ ফেরত (refund) যায়, তখন একটা অ্যাকাউন্ট বেছে নিতে হয়। ফেরত দিলে ব্যাংক ব্যালেন্স, আয় আর GST কমে। Statement-এ ক্রেডিট নোট আর ফেরত আলাদা লাইনে দেখায়, আর Print-এ ক্রেডিট নোটের কপি পাওয়া যায়। Refund ছাড়া ক্রেডিট নোট void করা যায়।
12. **Bills**: Money → Bills-এ নতুন বিল (সাপ্লায়ার, GST, ক্যাটাগরি, PDF সংযুক্তি)। Pay দিলে ledger-এ খরচ হয়, আর ড্যাশবোর্ডে "Bills to pay" কমে। Undo payment দিলে বিল আবার খোলা হয়।
13. **শেয়ার লিংক**: একটা ইনভয়েস বা প্রপোজালের পেজে Share link কপি করুন। তারপর অন্য ব্রাউজার বা private window-এ খুলুন: লগইন ছাড়াই দেখা যায়, প্রিন্ট করা যায়, আর প্রপোজাল accept বা decline করা যায়। **Reset link** দিলে পুরনো লিংক আর কাজ করে না।
14. **CSV import**: Leads-এ আর Money-তে **Import** বোতাম। প্রথমে ফাইল চেক হয় (preview, ভুল লাইন আর ডুপ্লিকেট দেখায়), তারপর ইমপোর্ট। নমুনা ফাইল ডায়ালগেই ডাউনলোড করা যায়।
15. **ক্লায়েন্ট portal assistant** (AI key লাগবে): client@demo.test দিয়ে ঢুকে মেনুতে **Assistant**, তারপর "What do I owe right now?" জিজ্ঞেস করুন। উত্তর শুধু Harbour Cafe-এর নিজের invoice, proposal আর project থেকে আসে। দাম কমানো বা deadline বদলের মতো অনুরোধ করলে **Send my question to the team** দেখায়, পাঠালে owner-এর notification আর Mailpit-এ ইমেইল যায়। Owner দিয়ে **Settings → AI assistant**-এ Off / All clients / শুধু টিক দেওয়া ক্লায়েন্ট বেছে নিন। demo-তে শুধু Harbour Cafe চালু আছে।
16. **Activity log**: উপরের সব পরিবর্তন সেখানে দেখা যাবে।
17. **Platform admin** (`/admin`): `.env.local`-এর `PLATFORM_ADMIN_EMAILS`-এর ইমেইল দিয়ে Google-এ ঢুকলে দেখা যাবে (Google সেটআপের পরে)।

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
- পুরনো ডেমো ডেটায় নতুন নমুনা (বিল, ক্রেডিট নোট) চাইলে শুধু `pnpm db:seed` চালান: কিছু মোছে না, শুধু যা নেই তা যোগ করে।
- ডেমো ডেটা একদম নতুন করে চাইলে প্রথমে `docker compose down -v`, তারপর `docker compose up -d`, তারপর `pnpm db:seed`।
- পুরনো service worker পুরনো পেজ দেখালে ব্রাউজারে hard reload (Ctrl+Shift+R) করুন।
