# OmniSuite সেটআপ গাইড (মালিকের জন্য)

এই গাইড ধাপে ধাপে দেখায় OmniSuite চালাতে বাইরের কোন কোন সার্ভিস লাগবে আর সেগুলো কীভাবে সেটআপ করবেন: GitHub, Google Cloud, Cloudflare, ইমেইল আর ব্যাকআপ। সব তথ্য ২০২৬-১১-১১ তারিখে প্রতিটা কোম্পানির অফিসিয়াল ডক দেখে মিলিয়ে নেওয়া। স্ক্রিন বা ফ্রি লিমিট পরে বদলাতে পারে, তাই প্রতিটা সেকশনের শেষে অফিসিয়াল লিংক দেওয়া আছে। যেটা মেলানো যায়নি, সেটা আলাদা করে লেখা আছে।

গোপন মান (API key, secret, password) কখনো চ্যাটে, ইমেইলে বা git-এ দেবেন না। এই গাইডে সব জায়গায় `<API_KEY>` এর মতো placeholder আছে, আসল মান শুধু সার্ভারের `.env` ফাইলে বসবে।

## এখন কী করা যায়, কী অপেক্ষায়

ডোমেইন (omniscopedigital.com) আর VPS কেনা আপাতত পিছিয়ে রাখা হয়েছে। তাই কিছু কাজ এখনই করা যায়, কিছু পরে।

| কাজ                                         | এখন করা যায়            | ডোমেইনের অপেক্ষায়             | VPS-এর অপেক্ষায়         |
| ------------------------------------------- | ----------------------- | ------------------------------ | ------------------------ |
| ১. GitHub billing lock ঠিক করা              | হ্যাঁ, সবার আগে         |                                |                          |
| ২. Google Cloud: প্রজেক্ট, OAuth client     | হ্যাঁ (localhost দিয়ে) | production URI, privacy policy |                          |
| ৩. Cloudflare: মার্কেটিং সাইট `workers.dev` | হ্যাঁ                   | নিজের ডোমেইন যোগ, DNS          | `app` DNS রেকর্ড         |
| ৪. ইমেইল পাঠানো (Resend)                    | শুধু অ্যাকাউন্ট খোলা    | ডোমেইন যোগ, DNS, verify        | `SMTP_URL` বসানো         |
| ৫. অফসাইট ব্যাকআপ (Cloudflare R2)           | bucket আর token বানানো  |                                | `.env`-এ বসিয়ে চালু করা |

## সূচিপত্র

1. [GitHub Actions: "account is locked due to a billing issue"](#1-github-actions-account-is-locked-due-to-a-billing-issue)
2. [Google Cloud: Google দিয়ে লগইন আর Drive/Sheets ব্যাকআপ](#2-google-cloud-google-দিয়ে-লগইন-আর-drivesheets-ব্যাকআপ)
3. [Cloudflare: মার্কেটিং সাইট আর পরে ডোমেইন](#3-cloudflare-মার্কেটিং-সাইট-আর-পরে-ডোমেইন)
4. [ইমেইল: একদম শুরু থেকে](#4-ইমেইল-একদম-শুরু-থেকে)
5. [ব্যাকআপ](#5-ব্যাকআপ)
6. [Stripe, Xero ও AI (Phase 7)](#6-stripe-xero-ও-ai-phase-7)
7. [BDT, USD আর AUD-এ কেনাকাটা লেখা](#7-bdt-usd-আর-aud-এ-কেনাকাটা-লেখা)

---

## 1. GitHub Actions: "account is locked due to a billing issue"

কেন: GitHub Actions বন্ধ থাকলে কোনো CI (টেস্ট, build, সাপ্তাহিক dependency আপগ্রেড) চলে না। এটা আগে ঠিক না করলে কোনো কোড পরিবর্তন যাচাই করা যাবে না।

### যা ঘটছে

- `mdraselswe` অ্যাকাউন্টের সব রিপোর প্রতিটা workflow এই মেসেজ দিয়ে ব্যর্থ হচ্ছে: "The job was not started because your account is locked due to a billing issue"।
- প্রায় সব রিপো PUBLIC। Public রিপোতে standard GitHub-hosted runner পুরোপুরি ফ্রি, তাই এটা মিনিট শেষ হওয়ার সমস্যা না।
- ৫ নভেম্বর ২০২৬ পর্যন্ত সব চলেছে, ৬ নভেম্বর প্রথম ব্যর্থ, ৭ নভেম্বর থেকে সব ব্যর্থ।
- Dependabot update এখনও সফল হচ্ছে।
- তাই এটা অ্যাকাউন্ট-লেভেলের billing lock, কোনো একটা রিপো বা প্রজেক্টের লিমিট না।

GitHub-এর অফিসিয়াল ডক বলে lock দুই কারণে হয়:

1. **Declined payment:** কোনো পেমেন্ট ব্যর্থ হয়ে বকেয়া (past due) হলে।
2. **Failed authorization hold:** Copilot সাইনআপ বা budget বাড়ানোর সময় GitHub কার্ড যাচাই করতে একটা ছোট hold দেয় ($1 থেকে সার্ভিসের দাম পর্যন্ত, ব্যাংক স্টেটমেন্টে `Card Verify` নামে দেখায়)। এই hold ব্যর্থ হলে personal অ্যাকাউন্টের billing lock হতে পারে, আর তখন **ফ্রি টায়ারেও Actions বন্ধ** হয়ে যায়। GitHub Free-এ থাকলেও, পেমেন্ট মেথড সরিয়ে দিলেও, কোনো Copilot প্ল্যান না থাকলেও এটা হতে পারে।

### ধাপ ১: আসল কারণ খুঁজে বের করা

GitHub-এ ডান দিকে উপরে প্রোফাইল ছবি → **Settings** → সাইডবারের **Access** অংশে **Billing & Licensing**। তারপর এগুলো দেখুন:

1. **Payment history:** ৬ নভেম্বর ২০২৬-এর আশেপাশে কোনো failed charge আছে কিনা।
2. **Licensing** (subscriptions): Copilot Pro, Codespaces, GitHub Sponsors, Marketplace app, Git LFS data pack। কোনো trial শেষ হয়েছে বা নতুন কিছু চালু হয়েছে কিনা।
3. **Budgets and alerts:** সম্প্রতি কোনো budget বাড়িয়েছেন বা নতুন বানিয়েছেন কিনা (budget বাড়ানোর সময়ই hold হয়)।
4. **Payment information:** কোনো কার্ড আছে কিনা, মেয়াদ শেষ কিনা।
5. **ইমেইল ইনবক্স:** ৫ থেকে ৭ নভেম্বরের মধ্যে GitHub থেকে billing, payment failed, Copilot বা trial নিয়ে কোনো ইমেইল (spam ফোল্ডারও দেখুন)।
6. **ব্যাংক স্টেটমেন্ট বা SMS:** `Card Verify` বা GitHub-এর কোনো declined লেনদেন।

অর্গানাইজেশনগুলোর (tajdid-academy, codeversebd, mdrasel-swe) billing আলাদা। প্রতিটার জন্য: প্রোফাইল ছবি → **Your organizations** → অর্গের পাশে **Settings** → **Billing & Licensing**। অর্গের রিপোর Actions আলাদা করে চলছে কিনা সেটাও দেখে নিন।

### ধাপ ২: সাধারণ কারণ আর সমাধান

**ক) কার্ড দিয়ে আন্তর্জাতিক/USD অনলাইন পেমেন্ট হয় না**

বাংলাদেশি debit কার্ডে এটা খুব সাধারণ। GitHub ডলারে charge বা hold করে, তাই কার্ডে international e-commerce চালু না থাকলে hold ব্যর্থ হয়।

1. ব্যাংকের অ্যাপ বা হেল্পলাইন থেকে কার্ডে international/online (e-commerce) transaction চালু করুন।
2. না হলে dual-currency কার্ড (USD অংশসহ) বা ভার্চুয়াল USD কার্ড ব্যবহার করুন, যেখানে ডলার ব্যালেন্স আছে।
3. **Billing & Licensing → Payment information → Payment method → Edit** দিয়ে নতুন কার্ড দিন। এতে নতুন authorization শুরু হয়।

(এই অংশটা GitHub-এর ডক থেকে না, বাংলাদেশি ব্যাংকের নিয়ম ব্যাংকভেদে আলাদা। নিজের ব্যাংক থেকে নিশ্চিত হয়ে নিন।)

**খ) কার্ডের মেয়াদ শেষ**

1. **Payment information → Edit** দিয়ে নতুন কার্ড দিন।
2. বকেয়া থাকলে সফল charge হলেই lock খুলে যাবে।

**গ) Copilot trial শেষ হয়েছে বা Copilot সাইনআপে hold ব্যর্থ**

1. **Licensing**-এ দেখুন Copilot Pro চালু আছে কিনা। দরকার না থাকলে বাতিল করুন।
2. চলমান paid trial থাকলে পেমেন্ট মেথড সরানো যায় না, আগে trial বাতিল করতে হয়।
3. তারপর **Payment information**-এ কাজ করে এমন কার্ড দিন, যাতে নতুন authorization সফল হয়।

**ঘ) Budget বাড়ানোর সময় hold ব্যর্থ**

1. **Budgets and alerts**-এ বাড়ানো budget আগের মানে ফেরত নিন বা মুছে দিন।
2. **Payment information**-এ কাজ করে এমন কার্ড দিয়ে আপডেট করুন।

### ধাপ ৩: কোনো পেমেন্ট মেথডই নেই, তবুও lock

GitHub-এর ডক বলে পেমেন্ট মেথড সরানো থাকলেও failed hold থেকে lock থাকতে পারে। দুইটা উপায়:

1. **কার্ড যোগ করে আবার সরানো:** কাজ করে এমন (USD সক্ষম) কার্ড যোগ করুন। Authorization সফল হলে lock নিজে খুলে যায়। তারপর চাইলে **Remove** দিয়ে কার্ড সরাতে পারেন। কার্ড সরাতে হলে ব্যালেন্স শূন্য হতে হবে আর এই মাসে (বা না-মেটানো আগের মাসে) কোনো billable metered usage থাকা যাবে না।
2. **সাপোর্টে lock review চাওয়া:** Billing & Licensing-এ কোনো সাবস্ক্রিপশন, বকেয়া বা পেমেন্ট সমস্যা না দেখালে https://support.github.com → **Sign in with GitHub** → নতুন টিকিট খুলুন। GitHub Free অ্যাকাউন্টও account সমস্যার জন্য টিকিট খুলতে পারে।

টিকিটে এটা পেস্ট করুন (তারিখ আর লিংক মিলিয়ে নিন):

```text
Subject: Account locked due to billing issue, GitHub Actions blocked on public repositories

Hello GitHub Support,

My personal account mdraselswe appears to be billing-locked. Since 6 November 2026,
every GitHub Actions job in my repositories fails with:

"The job was not started because your account is locked due to a billing issue"

Details:
- Plan: GitHub Free. Almost all affected repositories are public and use standard
  GitHub-hosted runners.
- Workflows ran successfully until 5 November 2026. The first failure was on
  6 November 2026, and every run has failed since 7 November 2026.
- Dependabot update runs still succeed.
- Billing & Licensing shows no active paid subscription, no outstanding balance and
  no payment problem that I can see. [Edit this line if you found something.]

Could you please review the lock on my account and tell me what caused it
(for example a failed authorization hold) and what I need to do to clear it?

Example failed run: <LINK_TO_A_FAILED_RUN>

Thank you,
Muhammad Rasel
```

### ধাপ ৪: lock খুলেছে কিনা দেখা

1. সফল charge বা authorization হলে lock নিজে খুলে যায়। পেমেন্ট প্রসেস হতে **২৪ ঘণ্টা পর্যন্ত** লাগতে পারে।
2. lock থাকা সময়ের জন্য GitHub কোনো টাকা নেয় না।
3. একটা রিপোর **Actions** ট্যাবে ব্যর্থ workflow খুলে **Re-run all jobs** দিন।
4. hold-এর টাকা GitHub সাথে সাথে ছেড়ে দেয়, কিন্তু ব্যাংকে ফেরত আসতে কয়েকদিন লাগতে পারে। ১০ কর্মদিবসেও না ফিরলে ব্যাংকে `Card Verify` নিয়ে জিজ্ঞেস করুন।

### GitHub Actions-এর লিমিট (docs.github.com থেকে মিলানো)

| বিষয়                                      | লিমিট                                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public রিপো, standard GitHub-hosted runner | ফ্রি, মিনিটের সীমা নেই, included usage থেকে কাটে না                                                                                                                         |
| Self-hosted runner                         | ফ্রি                                                                                                                                                                        |
| Private রিপো, GitHub Free                  | মাসে **$12 USD** মূল্যের "included compute usage" (এখন মিনিটে না, ডলারে মাপা হয়)। Linux runner $0.006/মিনিট, মানে প্রায় ২,০০০ Linux মিনিট                                 |
| Storage, GitHub Free                       | Artifact storage 500 MB (GitHub Packages-এর সাথে শেয়ার), cache রিপো প্রতি 10 GB                                                                                            |
| পেমেন্ট মেথড না থাকলে                      | Private রিপোতে included usage শেষ হলে Actions বন্ধ                                                                                                                          |
| একসাথে চলা job (GitHub Free)               | মোট ২০টা, এর মধ্যে macOS সর্বোচ্চ ৫টা                                                                                                                                       |
| একটা job-এর সর্বোচ্চ সময়                  | ৬ ঘণ্টা (GitHub-hosted runner), এর পরে job ব্যর্থ                                                                                                                           |
| একটা workflow run-এর সর্বোচ্চ সময়         | ৩৫ দিন (অপেক্ষা আর approval সহ)                                                                                                                                             |
| অর্গানাইজেশন                               | tajdid-academy, codeversebd, mdrasel-swe প্রত্যেকের নিজস্ব billing আর নিজস্ব $12 included usage (GitHub Free for organizations)। একটার lock অন্যটায় যায় কিনা ডকে লেখা নেই |

### মনে রাখবেন

সেকশন ৩-এর Cloudflare Workers Builds কোড build করে Cloudflare-এর নিজের মেশিনে, GitHub Actions-এ না। Cloudflare শুধু GitHub App দিয়ে রিপো পড়ে। তাই GitHub lock থাকলেও মার্কেটিং সাইট deploy হওয়ার কথা। (GitHub billing lock GitHub App-এর webhook আটকায় কিনা, সেটা কোনো অফিসিয়াল ডকে পাইনি।)

অফিসিয়াল ডক:

- https://docs.github.com/en/billing/how-tos/troubleshooting/locked-account
- https://docs.github.com/en/billing/how-tos/troubleshooting/authorization-holds
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
- https://docs.github.com/en/actions/reference/limits
- https://docs.github.com/en/support/contacting-github-support/creating-a-support-ticket

---

## 2. Google Cloud: Google দিয়ে লগইন আর Drive/Sheets ব্যাকআপ

কেন: "Continue with Google" লগইন আর প্রতিটা বিজনেসের নিজের Google Drive-এ ব্যাকআপ, দুইটার জন্যই Google Cloud-এ একটা OAuth client লাগে। এটা এখনই localhost দিয়ে বানানো যায়, ডোমেইন পরে যোগ হবে।

### যা জানা দরকার

- Google অ্যাকাউন্ট: **omniscope.digital@gmail.com** (সাধারণ Gmail)। Google Workspace লাগবে না। User type হবে **External**।
- লগইনের জন্য অ্যাপ চায়: `openid email profile` (Better Auth)।
- ব্যাকআপের জন্য অ্যাপ চায় শুধু `https://www.googleapis.com/auth/drive.file`। এতে অ্যাপ শুধু নিজের বানানো ফাইল দেখতে পায়, ব্যবহারকারীর বাকি Drive না।

Redirect URI (হুবহু কপি করুন):

| কোথায়     | URI                                                         |
| ---------- | ----------------------------------------------------------- |
| লোকাল      | `http://localhost:3000/api/auth/callback/google`            |
| লোকাল      | `http://localhost:3000/api/google/callback`                 |
| Production | `https://app.omniscopedigital.com/api/auth/callback/google` |
| Production | `https://app.omniscopedigital.com/api/google/callback`      |

Authorized JavaScript origins: `http://localhost:3000` আর `https://app.omniscopedigital.com`।

ডোমেইন এখনো কেনা হয়নি, তাই **এখন শুধু localhost-এর এন্ট্রিগুলো দিন**। Production এন্ট্রি ডোমেইন কেনার পরে যোগ করবেন।

### ধাপ ১: প্রজেক্ট বানানো

1. omniscope.digital@gmail.com দিয়ে https://console.cloud.google.com এ ঢুকুন।
2. উপরের প্রজেক্ট সিলেক্টর → **New project**।
3. Project name: `OmniSuite` → **Create**।
4. উপরে নতুন প্রজেক্টটা সিলেক্ট করা আছে কিনা দেখে নিন।

### ধাপ ২: Google Auth Platform কনফিগার করা

পুরনো "OAuth consent screen" এখন **Google Auth Platform** নামে, ভিতরে আলাদা পেজ: **Branding**, **Audience**, **Data access**, **Clients**।

1. বাম মেনু → **Google Auth Platform**। প্রথমবার হলে **Get started** দিয়ে অ্যাপ register করুন।
2. **Branding**:
   - App name: `OmniSuite`
   - User support email: `omniscope.digital@gmail.com`
   - App logo: **এখন খালি রাখুন** (নিচে কারণ আছে)
   - App domain (homepage, privacy policy, terms) আর Authorized domains: ডোমেইন কেনার পরে
   - Developer contact information: `omniscope.digital@gmail.com`
3. **Audience**:
   - User type: **External**
   - Publishing status: এখন **Testing** থাকবে
   - **Test users** → **Add users**: `omniscope.digital@gmail.com` আর যারা টেস্ট করবে তাদের Gmail। Testing অবস্থায় সর্বোচ্চ ১০০ জন test user, আর একবার যোগ করলে কোটা থেকে কমে যায়।
4. **Data access** → **Add or remove scopes**, এগুলো বেছে নিন:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
   - `https://www.googleapis.com/auth/drive.file`
   - তারপর **Update** → **Save**।

### ধাপ ৩: API চালু করা

1. বাম মেনু → **APIs & Services** → **Library**।
2. `Google Drive API` খুঁজে **Enable**।
3. `Google Sheets API` খুঁজে **Enable**।

### ধাপ ৪: OAuth client বানানো

1. **Google Auth Platform** → **Clients** → **Create client**।
2. Application type: **Web application**। Name: `OmniSuite web`।
3. **Authorized JavaScript origins** → **Add URI**: `http://localhost:3000`
4. **Authorized redirect URIs** → **Add URI** দুইবার:
   - `http://localhost:3000/api/auth/callback/google`
   - `http://localhost:3000/api/google/callback`
5. **Create**।

পরিবর্তন কার্যকর হতে ৫ মিনিট থেকে কয়েক ঘণ্টা লাগতে পারে। এর মধ্যে `redirect_uri_mismatch` এরর দেখালে একটু অপেক্ষা করুন।

### ধাপ ৫: Client ID আর Secret কপি করা

1. Client বানানোর পরেই **Client ID** আর **Client secret** দেখায়। **Secret পুরোটা একবারই দেখায়**, পরে শুধু শেষ ৪ অক্ষর দেখা যায়। তাই সাথে সাথে কপি করুন বা JSON ডাউনলোড করুন।
2. হারিয়ে গেলে client-এর পেজে **Add secret** দিয়ে নতুন secret বানানো যায় (একটা client-এ সর্বোচ্চ ২টা secret)।
3. লোকালে `.env.local`-এ, সার্ভারে `.env.production`-এ বসান:

```bash
GOOGLE_CLIENT_ID=<CLIENT_ID>
GOOGLE_CLIENT_SECRET=<CLIENT_SECRET>
```

4. অ্যাপ রিস্টার্ট করুন (লোকালে `pnpm dev` বন্ধ করে আবার চালান)।

Secret কখনো চ্যাটে পেস্ট করবেন না, git-এ commit করবেন না। রিপোটা PUBLIC, একবার push হলে ধরে নিন সবাই দেখেছে। তখন সাথে সাথে নতুন secret বানিয়ে পুরনোটা মুছে দিন।

### Testing বনাম In production

**Testing অবস্থায় ৭ দিনের সমস্যা (Google-এর ডকে নিশ্চিত):**

- External + Testing অ্যাপের refresh token **৭ দিনে মেয়াদ শেষ** হয়।
- ব্যতিক্রম: অ্যাপ যদি শুধু `openid`, email আর profile চায়। তাই **শুধু লগইন** Testing-এও ঠিকমতো চলবে।
- কিন্তু Drive ব্যাকআপ `drive.file` চায়, তাই Testing-এ **৭ দিন পরে ব্যাকআপ বন্ধ হয়ে যাবে**। তখন Settings → Backup থেকে আবার Connect করতে হবে।
- লোকাল টেস্টের জন্য এটা ঠিক আছে। আসল গ্রাহকের জন্য In production লাগবে।

**In production-এ নেওয়া:**

1. **Audience** → **Publish app** চাপলেই স্ট্যাটাস In production হয়, তখন যেকোনো Google অ্যাকাউন্ট ঢুকতে পারে আর ৭ দিনের নিয়ম থাকে না।
2. কিন্তু External production অ্যাপের জন্য Google চায়: নিজের ডোমেইনে homepage, একই ডোমেইনে privacy policy (homepage থেকে লিংক করা), terms of service, আর **Authorized domains**-এ ডোমেইন যোগ ও তার মালিকানা যাচাই। তাই এটা **ডোমেইন কেনার পরে**।
3. Authorized domain আগে যোগ করুন, তারপর production redirect URI, origin, homepage আর privacy URL।

**Verification কি লাগবে?**

- `drive.file`, `openid`, email, profile সবই **non-sensitive** scope। "Unverified app" সতর্কবার্তা আর ১০০ জনের সীমা শুধু sensitive বা restricted scope-এর জন্য, তাই সেই কঠিন data access verification আমাদের লাগবে না।
- তবে **brand verification** আলাদা জিনিস। External + published অ্যাপে consent screen-এ app name বা **logo** দেখাতে চাইলে brand verification লাগে (Branding পেজে **Verify branding**, পাস হলে ৭ দিনের মধ্যে **Publish branding**)। এর জন্যও ডোমেইন, homepage আর privacy policy লাগে। এই কারণে এখন logo খালি রাখতে বলা হয়েছে।
- Verification ছাড়া publish করলে consent screen-এ ঠিক কী নাম দেখাবে, সেটা Google-এর ডকে স্পষ্ট লেখা পাইনি।

অফিসিয়াল ডক:

- https://support.google.com/cloud/answer/15549049 (Branding)
- https://support.google.com/cloud/answer/15549945 (Audience, Testing, test users)
- https://support.google.com/cloud/answer/6158849 (OAuth client)
- https://developers.google.com/identity/protocols/oauth2 (refresh token-এর ৭ দিন)
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth (`drive.file` non-sensitive)
- https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification

---

## 3. Cloudflare: মার্কেটিং সাইট আর পরে ডোমেইন

কেন: মার্কেটিং সাইট (omni-scope) Cloudflare-এ ফ্রিতে চলবে আর প্রতিটা push-এ নিজে deploy হবে। পরে ডোমেইন কিনলে DNS, ইমেইল রাউটিং আর R2 ব্যাকআপ সব এক জায়গায় থাকবে।

ডোমেইন omniscopedigital.com এখনো কেনা হয়নি (এখন NXDOMAIN দেখায়)। তাই সেকশন দুই ভাগে: Part A এখন, Part B ডোমেইন কেনার পরে।

### Part A: এখন, ডোমেইন ছাড়া

**ধাপ ১: অ্যাকাউন্ট**

1. https://dash.cloudflare.com এ **omniscope.digital@gmail.com** দিয়ে সাইন আপ বা লগইন করুন।

**ধাপ ২: রিপো কানেক্ট করে Worker বানানো**

মার্কেটিং সাইটের রিপো `mdraselswe/omni-scope` (PRIVATE), Next.js static export, build-এর আউটপুট `out/` ফোল্ডারে। রিপোতে একটা `wrangler.jsonc` থাকবে (name `omni-scope`, static assets `./out` থেকে)। Cloudflare-এ Worker-এর নাম আর `wrangler.jsonc`-এর `name` একই হতে হবে।

1. **Workers & Pages** → **Create application** → রিপো import করার অপশন (Import a repository) → **GitHub**।
2. প্রথমবার GitHub-এ পাঠাবে। **Cloudflare Workers and Pages** অ্যাপ install করার সময় **Repository access**-এ **Only select repositories** বেছে শুধু `omni-scope` দিন।
3. রিপো তালিকা থেকে `omni-scope` বেছে নিন।
4. সেটিংস:
   - Project/Worker name: `omni-scope`
   - Git branch (production): `main`
   - Build command: `pnpm build`
   - Deploy command: `npx wrangler deploy` (এটাই ডিফল্ট)
   - Root directory: খালি (রিপোর রুট)
5. **Build variables** যোগ করুন (নিচে দেখুন), তারপর **Save and Deploy**।

**ধাপ ৩: Build variables**

Build variable শুধু build-এর সময় পাওয়া যায়, runtime-এ না। `NEXT_PUBLIC_*` মান build-এর সময়ই পেজে বসে যায়, তাই এখানেই দিতে হবে। পরে বদলাতে: Worker → **Settings** → **Build** → **Variables and secrets**।

```bash
NEXT_PUBLIC_SITE_URL=https://omni-scope.<YOUR_SUBDOMAIN>.workers.dev
NEXT_PUBLIC_WEB3FORMS_KEY=<WEB3FORMS_ACCESS_KEY>
```

- `<YOUR_SUBDOMAIN>` হলো আপনার অ্যাকাউন্টের `workers.dev` সাবডোমেইন, প্রথম deploy-এর পরে Worker-এর পেজে দেখা যাবে। প্রথম build-এর পরে মানটা ঠিক করে আবার deploy দিন।
- কন্টাক্ট ফর্ম ব্যবহার করলে `NEXT_PUBLIC_WEB3FORMS_KEY` দিন (রিপোর `.env.example`-এ আছে)।

**Node আর pnpm (Cloudflare ডক থেকে মিলানো):**

- Workers Builds Node-এর ভার্সন নেয় `NODE_VERSION` build variable বা রিপোর `.nvmrc` / `.node-version` থেকে। ডিফল্ট Node 24.22.1।
- omni-scope-এর `.nvmrc`-এ `26` লেখা আছে, তাই Cloudflare **Node 26** দিয়ে build করবে। এটা ঠিক আছে।
- Node 24 দিয়ে build করতে চাইলে `NODE_VERSION=24` build variable দিন। তবে `.nvmrc` আর `NODE_VERSION` দুটোই থাকলে কোনটা জিতবে, ডকে লেখা নেই। নিশ্চিত হতে `.nvmrc` বদলাতে হবে।
- pnpm চলে **Corepack** দিয়ে, আর `package.json`-এর `packageManager` (`pnpm@12.18.0`) মেনে চলে। তাই `PNPM_VERSION` দেওয়ার দরকার নেই। Build log-এ pnpm install-এর আউটপুটে আসল ভার্সন দেখে নিন।

**ধাপ ৪: ফলাফল**

- সাইট পাওয়া যাবে `https://omni-scope.<YOUR_SUBDOMAIN>.workers.dev` এ, ফ্রিতে।
- `main`-এ প্রতিটা push-এ নিজে build আর deploy হবে। অন্য branch-এ push করলে preview build হয়।
- GitHub-এ commit-এর পাশে Cloudflare-এর check দেখা যাবে।
- ফ্রি প্ল্যানের Workers Builds লিমিট: মাসে ৩,০০০ build মিনিট, একসাথে ১টা build, একটা build সর্বোচ্চ ২০ মিনিট।
- Static asset-এর request ফ্রি আর সীমাহীন। Worker-এ সর্বোচ্চ ২০,০০০ ফাইল, একটা ফাইল সর্বোচ্চ 25 MiB।

**ধাপ ৫ (ঐচ্ছিক): পুরনো Vercel প্রজেক্ট বন্ধ করা**

দুই জায়গায় deploy চললে বিভ্রান্তি হয়। Cloudflare-এ সাইট ঠিকমতো চললে:

1. Vercel dashboard → omni-scope প্রজেক্ট → **Settings** → **Git** → **Disconnect**।
2. পুরোপুরি সরাতে চাইলে **Settings** → **General** → **Delete Project** (এতে ওই প্রজেক্টের সব deployment আর domain মুছে যায়)।
3. GitHub-এ https://github.com/settings/installations থেকে Vercel অ্যাপের রিপো অ্যাক্সেসও সরিয়ে দিতে পারেন।

**OmniSuite অ্যাপ নিজে Cloudflare-এ যাবে না।** এর Postgres ডেটাবেস আর সবসময় চালু সার্ভার লাগে, তাই এটা VPS-এ Docker দিয়ে চলবে (`docker-compose.prod.yml`)। VPS কেনা আপাতত পিছিয়ে আছে।

### Part B: পরে, ডোমেইন কেনার পরে

1. **ডোমেইন কেনা:** Cloudflare Registrar-এ কেনা ঐচ্ছিক (এটা খরচের দামে বিক্রি করে, markup নেই)। অন্য কোথাও কিনলে Cloudflare-এ **Add a domain** করে Cloudflare যে দুইটা nameserver দেয়, রেজিস্ট্রারে সেগুলো বসান।
2. **Worker-এ ডোমেইন যোগ:** Workers & Pages → `omni-scope` → **Settings** → **Domains & Routes** → **Add** → **Custom Domain** → `omniscopedigital.com`। আবার `www.omniscopedigital.com` এর জন্য একই কাজ। Cloudflare নিজেই DNS রেকর্ড আর সার্টিফিকেট বানায়। ওই নামে আগে থেকে CNAME থাকলে হবে না।
3. Build variable `NEXT_PUBLIC_SITE_URL=https://omniscopedigital.com` করে আবার deploy দিন।
4. **অ্যাপের DNS** (VPS কেনার পরে), দুটোই **DNS only** (ধূসর মেঘ), কারণ VPS-এর Caddy নিজেই TLS সার্টিফিকেট নেয়:

| Type  | Name      | Content                    | Proxy status |
| ----- | --------- | -------------------------- | ------------ |
| A     | `app`     | `<VPS_IP>`                 | DNS only     |
| CNAME | `tenants` | `app.omniscopedigital.com` | DNS only     |

5. **SSL/TLS mode:** **SSL/TLS** → **Overview**-এ **Full (strict)** রাখুন (Cloudflare নিজেই Full বা Full (strict) সুপারিশ করে)। DNS only রেকর্ডে ট্রাফিক Cloudflare দিয়ে যায় না, তাই এই সেটিং সেগুলোর ওপর প্রভাব ফেলার কথা না, যদিও ডকে এটা সরাসরি লেখা নেই।
6. **ইমেইলের DNS:** সেকশন ৪ দেখুন।

অফিসিয়াল ডক:

- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/ci-cd/builds/build-image/
- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/
- https://developers.cloudflare.com/registrar/
- https://vercel.com/docs/git

---

## 4. ইমেইল: একদম শুরু থেকে

কেন: অ্যাপের অনেক কাজ ইমেইলের ওপর নির্ভর করে। লাইভ সার্ভারে একটা আসল ইমেইল পাঠানোর সার্ভিস না থাকলে কোনো ইমেইলই কারো কাছে পৌঁছাবে না।

### অ্যাপ কী কী ইমেইল পাঠায়

- টিম মেম্বার ইনভাইট
- ক্লায়েন্ট পোর্টাল ইনভাইট
- ইমেইল যাচাই আর পাসওয়ার্ড রিসেট (email + password লগইনের জন্য)
- ক্লায়েন্টকে ইনভয়েস আর প্রপোজাল পাঠানো
- বকেয়া ইনভয়েসের পেমেন্ট রিমাইন্ডার (নিজে থেকে, প্রতিদিন চেক করে)
- নোটিফিকেশন

### বিজনেসের নামে পাঠানো আর রিপ্লাই

- ক্লায়েন্টকে পাঠানো ইমেইলে প্রেরকের নাম হয় বিজনেসের নাম (যেমন "Harbour Studio <no-reply@omniscopedigital.com>")। ঠিকানা সবসময় `MAIL_FROM`-এরটাই থাকে, কারণ শুধু verified ডোমেইন থেকেই পাঠানো যায়।
- **Settings → General → Reply-to email:** এখানে বিজনেসের নিজের ইমেইল দিলে ক্লায়েন্ট "Reply" চাপলে উত্তর সেখানে যায়। খালি রাখলে উত্তর `no-reply`-তে যায়, মানে কেউ পায় না।
- **Settings → General → Payment reminders:** ডিফল্ট হলো due date-এর ৩ দিন আগে একটা, তারপর ১, ৭ আর ১৪ দিন পরে একটা করে। বন্ধ করা যায়, দিন বদলানো যায়। পেমেন্ট পুরো হলে, write off বা void করলে রিমাইন্ডার নিজে থেকে থেমে যায়। ইনভয়েস পেজের **Send reminder** বাটন দিয়ে হাতেও পাঠানো যায়।
- রিমাইন্ডার যায় ক্লায়েন্টের পোর্টাল ইউজারদের কাছে (যাদের ইনভয়েস দেখার অনুমতি আছে)। পোর্টাল ইউজার না থাকলে যায় ক্লায়েন্টের **Billing email**-এ (না থাকলে মূল ইমেইলে)।

### লোকালে বনাম লাইভে

- **লোকালে:** সব ইমেইল ধরে রাখে **Mailpit**, দেখা যায় http://localhost:8025 এ। কিছুই আসলে বাইরে যায় না। তাই লোকালে কিছু সেটআপ লাগে না।
- **লাইভ সার্ভারে:** একটা আসল পাঠানোর সার্ভিস লাগবে। না থাকলে অ্যাপ চলবে (ইমেইল ব্যর্থ হলে অ্যাপ লগে লিখে রাখে, আর লিংক অ্যাপেও দেখায়), কিন্তু কেউ ইমেইল পাবে না।

### কেন Gmail SMTP দিয়ে চলবে না

- **লিমিট:** সাধারণ Gmail দিনে প্রায় ৫০০ জনকে পাঠাতে পারে, বেশি হলে ১ থেকে ২৪ ঘণ্টা পাঠানো বন্ধ থাকে। সব বিজনেস মিলে এই সীমা দ্রুত শেষ হবে।
- **Deliverability:** ইমেইল যাবে `@gmail.com` থেকে, `@omniscopedigital.com` থেকে না। নিজের ডোমেইনের SPF/DKIM ছাড়া অন্যের নামে পাঠানো মেইল spam-এ যাওয়ার সম্ভাবনা বেশি।
- **App password:** SMTP-তে Gmail ব্যবহার করতে 2-Step Verification চালু করে app password বানাতে হয়। Google নিজেই বলে app password সুপারিশ করা হয় না। আর পাসওয়ার্ড ফাঁস হলে পুরো Gmail ঝুঁকিতে।

### দুইটা আলাদা জিনিস

1. **পাঠানো (Sending):** অ্যাপ থেকে ইমেইল যায় একটা SMTP সার্ভিস দিয়ে। এর জন্য Resend বা অন্য সার্ভিস।
2. **গ্রহণ করা (Receiving):** কেউ `hello@omniscopedigital.com` এ মেইল পাঠালে সেটা পাওয়া। এটা **Cloudflare Email Routing** দিয়ে ফ্রিতে করা যায়, যা মেইলটা আপনার Gmail-এ ফরোয়ার্ড করে দেয়।

### পাঠানোর সার্ভিস তুলনা (ফ্রি টায়ার মিলানো)

| সার্ভিস                  | ফ্রিতে কী পাবেন                                                                                      | ভালো দিক                                                  | খারাপ দিক                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **Resend**               | মাসে ৩,০০০ ইমেইল, **দিনে ১০০টা**, ৩টা ডোমেইন, ৩০ দিন লগ                                              | সবচেয়ে সহজ, Cloudflare DNS নিজে বসিয়ে দেয়, সাধারণ SMTP | দিনে ১০০-র সীমা, বাড়লে পেইড প্ল্যান                                              |
| **Brevo**                | দিনে প্রায় ৩০০টা (প্রায় মাসে ৯,০০০)                                                                | ফ্রিতে বেশি ইমেইল                                         | ফ্রিতে ইমেইলে Brevo branding থাকে বলে জানা যায়; অফিসিয়াল পেজ থেকে মেলাতে পারিনি |
| **Amazon SES**           | আলাদা ফ্রি কোটা নেই; নতুন AWS অ্যাকাউন্টে $200 পর্যন্ত Free Tier credit। পরে প্রতি ১,০০০ ইমেইল $0.10 | বড় হলে সবচেয়ে সস্তা                                     | সেটআপ জটিল, AWS অ্যাকাউন্ট আর কার্ড লাগে                                          |
| Cloudflare Email Sending | Workers Free-এ নেই; Workers Paid-এ মাসে ৩,০০০ included, পরে প্রতি ১,০০০-এ $0.35                      | সব Cloudflare-এ, SMTP আছে (`smtp.mx.cloudflare.net:465`)  | এখনো Beta, Workers Paid প্ল্যান লাগে                                              |

**সুপারিশ: Resend দিয়ে শুরু করুন।** শুরুর দিকে দিনে ১০০ ইমেইল যথেষ্ট, সেটআপ সবচেয়ে সহজ, আর ডোমেইন Cloudflare-এ থাকলে "Sign in to Cloudflare" বাটনে (Domain Connect) DNS রেকর্ড নিজে বসে যায়। বিজনেস বাড়লে পেইড প্ল্যান বা SES-এ যাওয়া যাবে, শুধু `SMTP_URL` বদলালেই হবে।

### Resend সেটআপ

এই পুরো অংশ **ডোমেইন কেনার অপেক্ষায়**, শুধু ধাপ ১ (অ্যাকাউন্ট খোলা) এখন করা যায়।

1. https://resend.com এ omniscope.digital@gmail.com দিয়ে সাইন আপ করুন। **(এখন করা যায়)**
2. **Domains** → **Add Domain** → `omniscopedigital.com` (চাইলে পাঠানোর region বেছে নিন)।
3. DNS রেকর্ড যোগ করুন। ডোমেইন Cloudflare-এ থাকলে **Sign in to Cloudflare** চাপুন, Resend নিজে রেকর্ড বসিয়ে দেবে। না হলে Cloudflare → ডোমেইন → **DNS** → **Records**-এ হাতে বসান। মান Resend-এর পেজ থেকে কপি করবেন:

| রেকর্ড | Type | Name                | কী কাজ করে                                                                                               |
| ------ | ---- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| MX     | MX   | `send`              | bounce আর ফেরত মেইল Resend-এর কাছে যায় (priority 10)                                                    |
| SPF    | TXT  | `send`              | পৃথিবীকে জানায় কোন সার্ভার আমাদের ডোমেইনের নামে পাঠাতে পারে                                             |
| DKIM   | TXT  | `resend._domainkey` | প্রতিটা ইমেইলে ডিজিটাল সই, যাতে প্রমাণ হয় পথে কেউ বদলায়নি; Proxy status **DNS only**                   |
| DMARC  | TXT  | `_dmarc`            | SPF/DKIM ব্যর্থ হলে অন্য সার্ভার কী করবে সেটা বলে; শুরুতে `v=DMARC1; p=none; rua=mailto:<REPORT_EMAIL>;` |

4. Resend-এর ডোমেইন পেজে verify চাপুন। সাধারণত কয়েক মিনিটে verified হয়।
5. DMARC কিছুদিন `p=none` রেখে সব ঠিক থাকলে `p=quarantine`, পরে `p=reject` করুন।
6. **API Keys** → **Create API Key** → Permission: **Sending access**, Domain: `omniscopedigital.com`। Key একবারই দেখায়, সাথে সাথে কপি করে সরাসরি সার্ভারের `.env.production`-এ রাখুন।

### অ্যাপের সেটিংস

অ্যাপ `SMTP_URL` সরাসরি nodemailer-এর `createTransport()`-এ দেয় (`src/server/mail.ts`), তাই এটা একটা nodemailer connection URL। Resend-এর SMTP: host `smtp.resend.com`, username `resend`, password হলো API key, port 465 (implicit TLS)। `smtps://` মানে 465-এ শুরু থেকেই এনক্রিপ্টেড।

সার্ভারের `.env.production`-এ:

```bash
SMTP_URL=smtps://resend:<RESEND_API_KEY>@smtp.resend.com:465
MAIL_FROM=OmniSuite <no-reply@omniscopedigital.com>
APP_URL=https://app.omniscopedigital.com
```

- Key-এ `@`, `:`, `/` বা `%` এর মতো অক্ষর থাকলে URL-encode করতে হবে (Resend-এর key সাধারণত `re_` দিয়ে শুরু, অক্ষর আর সংখ্যা)।
- `MAIL_FROM`-এর ডোমেইন Resend-এ verified ডোমেইন হতে হবে।
- `APP_URL` ইমেইলের লিংকে ব্যবহার হয়।
- বসানোর পরে অ্যাপ রিস্টার্ট করুন:

```bash
docker compose -f docker-compose.prod.yml up -d
```

- টেস্ট: নিজের আরেকটা ইমেইলে টিম ইনভাইট পাঠান। না পৌঁছালে অ্যাপের লগে `[mail] send failed` খুঁজুন:

```bash
docker compose -f docker-compose.prod.yml logs app | grep "\[mail\]"
```

### ইমেইল গ্রহণ: Cloudflare Email Routing (ফ্রি)

এটাও ডোমেইনের অপেক্ষায়। ইনবাউন্ড Email Routing Workers Free প্ল্যানেও সীমাহীন আর ফ্রি।

1. Cloudflare → **Compute** → **Email Service** → **Email Routing** → **Onboard Domain** → `omniscopedigital.com`।
2. Cloudflare যে MX, SPF, DKIM রেকর্ড যোগ করবে সেগুলো দেখে **Done**।
3. **Destination Addresses**-এ `omniscope.digital@gmail.com` যোগ করুন। Gmail-এ Cloudflare-এর ইমেইল খুলে **Verify email address** চাপুন।
4. **Routing Rules** → **Create routing rule** → Email pattern `hello` → Action **Send to an email** → আপনার Gmail → **Save**।
5. অন্য অ্যাকাউন্ট থেকে `hello@omniscopedigital.com` এ মেইল পাঠিয়ে টেস্ট করুন (spam ফোল্ডারও দেখুন)।

সতর্কতা: Resend-এর MX `send` সাবডোমেইনে, আর Email Routing-এর MX মূল ডোমেইনে। তাই দুটো একসাথে চলে। কিন্তু SPF রেকর্ড একটা নামে একটাই থাকতে পারে, তাই মূল ডোমেইনে দুইটা আলাদা `v=spf1` TXT রেকর্ড বানাবেন না।

অফিসিয়াল ডক:

- https://resend.com/docs/send-with-smtp
- https://resend.com/pricing
- https://resend.com/docs/knowledge-base/cloudflare
- https://resend.com/docs/dashboard/domains/dmarc
- https://www.brevo.com/pricing/
- https://aws.amazon.com/ses/pricing/
- https://developers.cloudflare.com/email-service/platform/pricing/
- https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/
- https://support.google.com/mail/answer/22839 (Gmail-এর সীমা)
- https://support.google.com/accounts/answer/185833 (App password)

---

## 5. ব্যাকআপ

কেন: VPS নষ্ট হলে, ভুলে কিছু মুছে গেলে বা হ্যাক হলে সব বিজনেসের হিসাব হারানো চলবে না। তাই ব্যাকআপ কয়েক স্তরে, আর অন্তত একটা কপি VPS-এর বাইরে।

### যা আগে থেকেই তৈরি

1. **রাতের ডেটাবেস dump:** `docker-compose.prod.yml`-এর `db-backup` কন্টেইনার প্রতিদিন `pg_dump` চালিয়ে `backups` volume-এ ফাইল রাখে (`omnisuite-YYYY-MM-DD.dump`), ১৪ দিনের পুরনোগুলো মুছে দেয়। কিন্তু এটা **একই VPS-এ**, তাই VPS গেলে এটাও যাবে।
2. **আপলোড করা ফাইল:** `files` volume-এ থাকে (অ্যাপের ভিতরে `/app/storage`)।
3. **প্রতিটা বিজনেসের নিজের Google Drive:** Settings → Backup → **Connect Google** করলে ওই বিজনেসের ডেটা এক দিকে (one-way) তাদের Drive-এ যায়: একটা Sheets কপি আর রাতে JSON snapshot। `drive.file` scope, তাই অ্যাপ শুধু নিজের বানানো ফাইল দেখে। (মনে রাখবেন, Google অ্যাপ Testing অবস্থায় থাকলে এটা ৭ দিন পরে থেমে যায়, সেকশন ২ দেখুন।)

### যা এখন যোগ হচ্ছে: R2-তে অফসাইট ব্যাকআপ

`docker-compose.prod.yml`-এ নতুন `offsite-backup` সার্ভিস (rclone দিয়ে) প্রতি রাতে dump ফোল্ডার আর আপলোড করা ফাইল **Cloudflare R2** bucket-এ কপি করবে। VPS পুরো নষ্ট হলেও তখন ডেটা থাকবে।

এটা `docker-compose.prod.yml`-এর পাশের `.env` ফাইল থেকে এগুলো পড়ে:

```bash
R2_ACCOUNT_ID=<ACCOUNT_ID>
R2_ACCESS_KEY_ID=<ACCESS_KEY_ID>
R2_SECRET_ACCESS_KEY=<SECRET_ACCESS_KEY>
R2_BUCKET=omnisuite-backups
```

`R2_BUCKET` না দিলে ডিফল্ট `omnisuite-backups`।

**R2 bucket আর token এখনই বানানো যায়। সার্ভারে বসানো আর চালু করা VPS কেনার পরে।**

### R2 ফ্রি টায়ার (Cloudflare ডক থেকে)

| বিষয়                            | মাসে ফ্রি            |
| -------------------------------- | -------------------- |
| Storage (Standard)               | 10 GB-month          |
| Class A operations (লেখা, লিস্ট) | ১০ লক্ষ (1 million)  |
| Class B operations (পড়া)        | ১ কোটি (10 million)  |
| Egress (ডাউনলোড)                 | ফ্রি, কোনো চার্জ নেই |

ফ্রি টায়ার শুধু **Standard** storage-এ, Infrequent Access-এ না। Bucket বানানোর সময় Standard রাখুন।

### ধাপ ১: R2 চালু করা

1. Cloudflare dashboard → **Storage & databases** → **R2** → **Overview**।
2. Checkout flow শেষ করে R2 subscription যোগ করুন। ফ্রি সীমার মধ্যে থাকলে খরচ $0।

পেমেন্ট মেথড: Cloudflare-এর অফিসিয়াল ডক স্পষ্ট বলে না ফ্রি টায়ারেও কার্ড লাগে কিনা। শুধু বলে checkout শেষ করতে হবে। কয়েকটা তৃতীয় পক্ষের গাইড বলে প্রথম bucket বানানোর আগে কার্ড বা PayPal চায়। তাই একটা USD-সক্ষম কার্ড হাতে রাখুন (সেকশন ১-এর কার্ডের কথা এখানেও খাটে)।

### ধাপ ২: Bucket বানানো

1. **R2** → **Overview** → **Create bucket**।
2. Bucket name: `omnisuite-backups` (শুধু ছোট হাতের অক্ষর, সংখ্যা আর হাইফেন, ৩ থেকে ৬৩ অক্ষর)।
3. **Location**: Automatic না রেখে তালিকা থেকে **Oceania (`oc`)** বা **Asia-Pacific (`apac`)** বেছে নিন। VPS যেখানে হবে তার কাছেরটা নিন। এটা শুধু একটা ইঙ্গিত, গ্যারান্টি না, আর প্রথমবার বানানোর সময়ই কাজ করে।
4. Default storage class: **Standard**।
5. **Create bucket**।
6. Bucket পাবলিক করবেন না। Public access বন্ধই থাকবে।

### ধাপ ৩: API token বানানো

1. **R2** → **Overview** → **Account Details** অংশে **API Tokens**-এর পাশে **Manage**।
2. **Create Account API token** (অ্যাকাউন্টের সাথে থাকে, আপনার ইউজার সরলেও চলে)।
3. Token name: `omnisuite-offsite-backup`।
4. Permissions: **Object Read & Write**।
5. শুধু নির্দিষ্ট bucket-এ সীমিত করুন: `omnisuite-backups`।
6. **Create Account API token**।
7. পরের পেজে **Access Key ID** আর **Secret Access Key** দেখাবে। **Secret একবারই দেখায়**, সাথে সাথে কপি করে নিরাপদ জায়গায় (password manager) রাখুন।
8. **Account ID** কপি করুন (R2 Overview-এর Account Details-এ বা dashboard-এ)। S3 endpoint হবে `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`।

### ধাপ ৪: VPS-এ বসানো (VPS কেনার পরে)

1. VPS-এ `docker-compose.prod.yml` যে ফোল্ডারে, সেখানকার `.env` ফাইল খুলুন:

```bash
nano .env
```

2. উপরের চারটা `R2_*` লাইন আসল মান দিয়ে যোগ করুন, সেভ করুন।
   - এই `.env`-এ `BETTER_AUTH_SECRET` আর `ENCRYPTION_KEY`-ও থাকতে হবে (`.env.production`-এর একই মান)। না থাকলে `docker compose` চালুই হবে না, আর development-এর default মান থাকলে অ্যাপ production-এ চালু হতে অস্বীকার করবে।
3. ফাইলটা শুধু আপনি পড়তে পারবেন এমন করুন:

```bash
chmod 600 .env
```

4. রিস্টার্ট করুন:

```bash
docker compose -f docker-compose.prod.yml up -d
```

5. সার্ভিসের লগ দেখুন:

```bash
docker compose -f docker-compose.prod.yml logs -f offsite-backup
```

### কাজ করছে কিনা দেখা

1. পরের রাতের পরে (বা লগে প্রথম রান শেষ হলে) Cloudflare → **R2** → `omnisuite-backups` খুলুন।
2. dump ফাইল (`omnisuite-YYYY-MM-DD.dump`) আর আপলোড করা ফাইলের ফোল্ডার দেখা যাওয়ার কথা। ফোল্ডারের নাম `offsite-backup` সার্ভিসের কনফিগ অনুযায়ী হবে।
3. সর্বশেষ dump-এর তারিখ আজকের বা গতকালের কিনা, আর সাইজ শূন্য না কিনা দেখুন।

### Restore drill (অভ্যাস করে রাখা)

ব্যাকআপ আছে কিনা না, **restore করা যায় কিনা** সেটাই আসল প্রশ্ন। মাসে একবার একটা আলাদা টেস্ট ডেটাবেসে restore করে দেখুন, আসল ডেটাবেসে হাত না দিয়ে।

1. R2 bucket থেকে সর্বশেষ dump ডাউনলোড করে VPS-এ রাখুন (dashboard-এ ফাইল → **Download**, তারপর `scp` দিয়ে VPS-এ)।
2. Postgres কন্টেইনারে কপি করুন:

```bash
docker compose -f docker-compose.prod.yml cp ./omnisuite-YYYY-MM-DD.dump postgres:/tmp/restore.dump
```

3. আলাদা টেস্ট ডেটাবেস বানিয়ে সেখানে restore করুন:

```bash
docker compose -f docker-compose.prod.yml exec postgres createdb -U omnisuite omnisuite_drill
```

```bash
docker compose -f docker-compose.prod.yml exec postgres pg_restore -U omnisuite -d omnisuite_drill /tmp/restore.dump
```

4. কিছু টেবিল আছে কিনা দেখুন, তারপর টেস্ট ডেটাবেস মুছে দিন:

```bash
docker compose -f docker-compose.prod.yml exec postgres psql -U omnisuite -d omnisuite_drill -c "\dt"
```

```bash
docker compose -f docker-compose.prod.yml exec postgres dropdb -U omnisuite omnisuite_drill
```

**সত্যিকারের দুর্ঘটনায় আসল ডেটাবেস restore** (এতে বর্তমান ডেটা মুছে dump-এর ডেটা বসে):

```bash
docker compose -f docker-compose.prod.yml stop app
```

```bash
docker compose -f docker-compose.prod.yml exec postgres pg_restore -U omnisuite -c -d omnisuite /tmp/restore.dump
```

```bash
docker compose -f docker-compose.prod.yml start app
```

**আপলোড করা ফাইল restore:** R2 থেকে ফাইলের ফোল্ডার ডাউনলোড করে (যেমন `./files`), তারপর:

```bash
docker compose -f docker-compose.prod.yml cp ./files/. app:/app/storage/
```

### মাসিক চেকলিস্ট

1. R2 bucket-এ সর্বশেষ dump গতকালের কিনা।
2. Dump-এর সাইজ হঠাৎ অনেক কমে যায়নি তো।
3. একটা restore drill (উপরের ধাপ) করা হয়েছে।
4. R2 storage ১০ GB-এর কাছাকাছি কিনা (R2 → Overview → usage)।
5. VPS-এর ডিস্কে জায়গা আছে কিনা (`df -h`)।
6. কয়েকটা বিজনেসের Settings → Backup-এ Google Drive কানেকশন চালু আছে কিনা।
7. R2 token বা Google secret কোথাও ফাঁস হয়েছে সন্দেহ হলে নতুন বানিয়ে পুরনোটা মুছে দিন।

অফিসিয়াল ডক:

- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/get-started/
- https://developers.cloudflare.com/r2/buckets/create-buckets/
- https://developers.cloudflare.com/r2/reference/data-location/
- https://developers.cloudflare.com/r2/api/tokens/
- https://rclone.org/s3/#cloudflare-r2
- https://www.postgresql.org/docs/current/app-pgrestore.html

---

## 6. Stripe, Xero ও AI (Phase 7)

কোড সব তৈরি, কিন্তু প্রতিটা ফিচার ততক্ষণ **বন্ধ** থাকে যতক্ষণ তার key `.env`-এ বসানো না হয়। তাই কোনোটা বাধ্যতামূলক না: যেটা দরকার সেটা চালু করবেন। সব key শুধু `.env.local` (লোকাল) বা `.env.production` (সার্ভার)-এ, কখনো চ্যাটে বা git-এ না।

| ফিচার                           | কে টাকা পায়/দেয়                       | চালু করতে লাগে                                                |
| ------------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| ৬.১ ক্লায়েন্টের অনলাইন পেমেন্ট | ক্লায়েন্ট → প্রতিটা business-এর Stripe | business নিজে Settings → Online payments-এ key বসায়          |
| ৬.২ OmniSuite সাবস্ক্রিপশন      | business → আপনার (platform) Stripe      | `STRIPE_*` env (শুধু আপনি, platform owner)                    |
| ৬.৩ Xero                        | —                                       | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET` env + business connect |
| ৬.৪ AI assistant                | যে AI provider বাছবেন                   | `ANTHROPIC_API_KEY` বা অন্য provider-এর key (env)             |

### ৬.১ ক্লায়েন্টের অনলাইন কার্ড পেমেন্ট (প্রতিটা business-এর নিজের Stripe)

কেন: ক্লায়েন্ট portal-এ invoice খুলে "Pay online" চাপলে Stripe-এর নিরাপদ পাতায় কার্ডে পেমেন্ট করে। টাকা সরাসরি ওই business-এর Stripe অ্যাকাউন্টে যায়, আর OmniSuite নিজে থেকে invoice-এ payment লিখে দেয় (ledger-এ income সহ)।

1. business-এর মালিক stripe.com-এ অ্যাকাউন্ট খোলেন (Australia, business details, bank account)। প্রথমে **Test mode**-এ চেষ্টা করুন।
2. Stripe Dashboard → **Developers → API keys** → secret key কপি করুন (`sk_test_…`)। আরও নিরাপদ: **Create restricted key** → শুধু "Checkout Sessions: Write" দিন (`rk_test_…`)।
3. OmniSuite → **Settings → Online payments** খুলুন। পাতায় একটা **Webhook address** দেখাবে (যেমন `https://app.omniscopedigital.com/api/stripe/webhook/<id>`)। এটা কপি করুন।
4. Stripe Dashboard → **Developers → Webhooks → Add endpoint** → ওই address বসান → events বাছুন: `checkout.session.completed`, `checkout.session.async_payment_succeeded` আর `charge.refunded` (refund হলে ledger ঠিক রাখতে) → Save → **Signing secret** (`whsec_…`) কপি করুন।
5. OmniSuite-এ secret key, signing secret, কোন bank account-এ টাকা জমা হবে বেছে **Save** চাপুন। OmniSuite key-টা Stripe-এ যাচাই করে নেয়।
6. পরীক্ষা: একটা invoice "Sent" করুন → client হিসেবে portal-এ গিয়ে **Pay online** → Stripe-এর test কার্ড `4242 4242 4242 4242`, যেকোনো ভবিষ্যৎ তারিখ, যেকোনো CVC → কিছুক্ষণ পরে invoice "Paid" হবে।
7. সব ঠিক থাকলে Stripe-এ **live** key আর live webhook বানিয়ে একইভাবে বসান।

মনে রাখবেন: webhook কাজ করতে অ্যাপকে ইন্টারনেট থেকে দেখা যেতে হবে, তাই লোকালে শুধু [Stripe CLI](https://docs.stripe.com/stripe-cli) দিয়ে পরীক্ষা করা যায় (`stripe listen --forward-to localhost:3000/api/stripe/webhook/<id>`, তারপর CLI যে `whsec_…` দেয় সেটা বসান)। আসল ব্যবহার VPS-এর পরে।

### ৬.২ OmniSuite সাবস্ক্রিপশন (business-রা আপনাকে মাসিক টাকা দেয়)

কেন: অন্য business OmniSuite ব্যবহার করলে প্ল্যান অনুযায়ী মাসিক টাকা আপনার Stripe অ্যাকাউন্টে আসে। প্রথমবার ৩০ দিন ফ্রি ট্রায়াল। প্ল্যান অনুযায়ী টিম মেম্বার সংখ্যা সীমিত থাকে (Starter ৩, Growth ১৫, Scale সীমাহীন)। `STRIPE_*` না বসালে এই ফিচার বন্ধ থাকে, কোনো লিমিটও থাকে না।

1. **আপনার নিজের** (OmniScope Digital-এর) Stripe অ্যাকাউন্টে, প্রথমে Test mode-এ: **Product catalog → Add product** → তিনটা product: Starter, Growth, Scale। প্রতিটার **recurring monthly price** (AUD) দিন। প্রতিটা price-এর id (`price_…`) কপি করুন।
2. দাম বদলালে কোডেও মিলিয়ে দিন: `src/config/billing.ts`-এ `price.amount` (শুধু কার্ডে দেখানোর জন্য) আর `maxMembers`।
3. **Settings → Billing → Customer portal** চালু করুন: card update, invoice history, cancel আর **switch plans** (তিনটা price যোগ করে) allow করুন।
4. **Developers → Webhooks → Add endpoint** → `https://app.omniscopedigital.com/api/stripe/webhook` → events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed` → signing secret কপি।
5. সার্ভারের env-এ বসান, তারপর restart:

```bash
STRIPE_SECRET_KEY=<sk_…>
STRIPE_WEBHOOK_SECRET=<whsec_…>
STRIPE_PRICE_STARTER=<price_…>
STRIPE_PRICE_GROWTH=<price_…>
STRIPE_PRICE_SCALE=<price_…>
```

6. business owner হিসেবে **Settings → Subscription** → একটা প্ল্যান → Stripe test কার্ড দিয়ে শেষ করুন → পাতায় "Free trial" দেখাবে। **Manage billing** চাপলে Stripe-এর portal খোলে।
7. Platform admin পাতায় (`/admin`) প্রতিটা business-এর subscription status দেখা যায়।

### ৬.৩ Xero (হিসাব সফটওয়্যারে স্বয়ংক্রিয় কপি)

কেন: OmniSuite-এর client, invoice আর payment একমুখী (OmniSuite → Xero) প্রতি ঘণ্টায় Xero-তে চলে যায়, তাই accountant Xero-তেই সব পান। Xero-তে বদলালে OmniSuite-এ ফিরে আসে না।

1. developer.xero.com-এ লগইন → **My Apps → New app**।
2. Integration type: **Web app**। App name: OmniSuite। Company URL: `https://app.omniscopedigital.com` (ডোমেইন না থাকলে আপাতত যেকোনো আপনার URL)।
3. Redirect URI: লোকালে `http://localhost:3000/api/xero/callback`, পরে `https://app.omniscopedigital.com/api/xero/callback`।
4. App বানিয়ে **Configuration** → **Client ID** কপি → **Generate a secret** → secret কপি।
5. env-এ বসান আর restart:

```bash
XERO_CLIENT_ID=<client id>
XERO_CLIENT_SECRET=<client secret>
```

6. OmniSuite → **Settings → Xero → Connect Xero** → Xero-তে লগইন → organisation বেছে **Allow**।
7. Xero-র Chart of accounts দেখে account code মিলিয়ে নিন: sales (সাধারণত `200`), payment-এর bank account (`090`, Xero-তে এই account-এ "Enable payments" চালু থাকতে হবে), GST tax type (`OUTPUT`)। তারপর **Sync now**।
8. জেনে রাখুন: OmniSuite নতুন granular scope চায় (`accounting.contacts`, `accounting.invoices`, `accounting.payments`, `offline_access`)। Certify না করা app সর্বোচ্চ ২৫টা organisation connect করতে পারে, যা এখনকার জন্য যথেষ্ট। ৬০ দিন sync না হলে আবার Connect করতে হবে।

### ৬.৪ AI assistant (Claude, ChatGPT, Gemini, DeepSeek ও অন্যরা)

কেন: proposal লেখার সময় **Draft with AI** ছোট brief থেকে title, intro, terms আর line items-এর খসড়া বানায় (সেভ করার আগে আপনি দেখে বদলাবেন)। Dashboard-এ **AI insights** বোতাম ব্যবসার মোট সংখ্যা দেখে ৩–৫টা পরামর্শ দেয়। শুধু বোতাম চাপলেই চলে, নিজে থেকে না, তাই খরচ নিয়ন্ত্রণে থাকে।

৯টা provider আগে থেকেই বসানো আছে। যার key env-এ দেবেন, শুধু সেটা চালু হবে:

| Provider                                           | env-এ key                   | key কোথায় পাবেন                  | ফ্রি?                                                  |
| -------------------------------------------------- | --------------------------- | --------------------------------- | ------------------------------------------------------ |
| Claude (ডিফল্ট)                                    | `ANTHROPIC_API_KEY`         | platform.claude.com/settings/keys | না, যত ব্যবহার তত টাকা                                 |
| OpenAI (ChatGPT)                                   | `OPENAI_API_KEY`            | platform.openai.com/api-keys      | না                                                     |
| Google Gemini                                      | `GEMINI_API_KEY`            | aistudio.google.com/apikey        | হ্যাঁ, তবে ফ্রি প্ল্যানে prompt দিয়ে ট্রেনিং হতে পারে |
| DeepSeek                                           | `DEEPSEEK_API_KEY`          | platform.deepseek.com/api_keys    | না, তবে খুব সস্তা                                      |
| xAI (Grok)                                         | `XAI_API_KEY`               | console.x.ai                      | না                                                     |
| Mistral                                            | `MISTRAL_API_KEY`           | console.mistral.ai/api-keys       | হ্যাঁ (Experiment প্ল্যান, ট্রেনিং হতে পারে)           |
| Groq (ওপেন মডেল, খুব দ্রুত)                        | `GROQ_API_KEY`              | console.groq.com/keys             | হ্যাঁ, rate limit সহ                                   |
| OpenRouter (এক key-তে অনেক মডেল)                   | `OPENROUTER_API_KEY`        | openrouter.ai/settings/keys       | হ্যাঁ, ফ্রি মডেলে ট্রেনিং হতে পারে                     |
| অন্য যেকোনো OpenAI-style (যেমন নিজের পিসির Ollama) | `OPENAI_COMPATIBLE_API_KEY` | নিজের সার্ভার                     | হ্যাঁ                                                  |

1. যে provider চান তার সাইটে অ্যাকাউন্ট খুলে **API key** বানান। Paid provider হলে Billing-এ credit বা কার্ড দিন, না দিলে অনুরোধ ব্যর্থ হবে।
2. key বসান `.env.local`-এ (সার্ভারে env ফাইলে), যেমন `GEMINI_API_KEY=<key>`, তারপর restart। key কখনো chat, git বা অন্য কোথাও দেবেন না।
3. পরীক্ষা: `pnpm ai:check`। প্রতিটা provider-এর key কাজ করছে কি না আর কোন কোন মডেল পাওয়া যায় দেখায় (কোনো token খরচ হয় না)। `pnpm ai:check --ping` প্রতিটাকে একটা ছোট অনুরোধ পাঠায় (কয়েকটা token)। Platform admin `/admin` পেজের নিচে একই অবস্থা দেখতে পাবেন।
4. কোনটা ব্যবহার হবে সেটা `src/config/ai.ts`-এ:
   - `defaultProvider: "gemini"` দিলে সব feature Gemini ব্যবহার করবে।
   - `features: { insights: { provider: "groq" } }` দিলে শুধু ওই feature অন্যটা নেবে।
   - `fallbackProviders: ["gemini", "groq"]` দিলে মূল provider-এর limit শেষ হলে, credit না থাকলে বা সার্ভিস বন্ধ থাকলে এগুলো ক্রমানুসারে চেষ্টা হবে (যাদের key আছে শুধু তারা)।
5. মডেলের নাম প্রায়ই বদলায়। `ai:check` যদি বলে মডেল পাওয়া যায়নি, যে তালিকা দেখায় সেখান থেকে একটা নাম `src/config/ai.ts`-এ বসান।
6. প্রতিটা business দিনে সর্বোচ্চ ৫০টা AI অনুরোধ করতে পারে। বদলাতে `src/config/ai.ts`-এ `dailyRequestsPerBusiness`।
7. যে business AI চায় না, সে **Settings → Modules**-এ "AI assistant" বন্ধ করতে পারে। ব্যবহারের অনুমতি (`ai.use`) owner, admin আর manager-এর আছে, Team → Roles-এ বদলানো যায়।
8. গোপনীয়তা: insights-এ শুধু মোট সংখ্যা যায়, কোনো ক্লায়েন্টের নাম না। Proposal draft-এ আপনার লেখা brief আর ক্লায়েন্টের নাম যে provider ব্যবহার হচ্ছে সেখানে যায়। যে ফ্রি প্ল্যানে ট্রেনিং হতে পারে (Gemini, Mistral, OpenRouter ফ্রি), সেটা শুধু demo ডেটা দিয়ে পরীক্ষার জন্য। আসল ক্লায়েন্টের কাজে paid প্ল্যান ব্যবহার করুন।

জেনে রাখুন: Claude Max, ChatGPT Plus বা Gemini Advanced-এর মতো chat subscription দিয়ে API চলে না। অ্যাপের জন্য প্রতিটা provider-এর developer console থেকে আলাদা API key লাগে। বিস্তারিত: `docs/configuration.md` → AI providers।

অফিসিয়াল লিংক: [Stripe Checkout](https://docs.stripe.com/payments/checkout) · [Stripe webhooks](https://docs.stripe.com/webhooks) · [Stripe customer portal](https://docs.stripe.com/customer-management) · [Xero OAuth 2.0](https://developer.xero.com/documentation/guides/oauth2/overview) · [Xero scopes](https://developer.xero.com/documentation/guides/oauth2/scopes) · [Claude API](https://docs.claude.com/)

---

## 7. BDT, USD আর AUD-এ কেনাকাটা লেখা

ব্যবসার মূল currency (base currency) AUD। সব রিপোর্ট, লাভ আর partner-এর ভাগ AUD-এ হিসাব হয়। অন্য currency-র account-এ লেনদেন লিখলে OmniSuite একটা exchange rate চায় আর AUD-এর অঙ্কটাও সেভ করে রাখে।

মনে রাখার নিয়ম: **টাকা যে account থেকে আসলে বের হয়েছে, সেই account-এ, সেই currency-তে লিখুন।**

### শুরুতে একবার

1. **Finance → Setup → New account**-এ প্রতিটা আসল account আলাদা করে বানান, ঠিক currency বেছে: যেমন "bKash" (BDT), "City Bank" (BDT), "CommBank" (AUD), "AUD card" (AUD), "Wise USD" বা "Payoneer" (USD)। Currency বাক্সে লিখে খুঁজুন: `BDT`, `taka`, `USD`।
2. **Settings → General**-এ business currency AUD রাখুন। টাকা লেখা শুরু হলে (লেনদেন, invoice, proposal বা capital) এটা আর বদলানো যায় না, কারণ আগের সব মোট অঙ্ক ভুল হয়ে যাবে। ভুল currency দিয়ে শুরু করলে টাকা লেখার আগেই ঠিক করুন।

### (ক) BDT account থেকে খরচ (bKash, বাংলাদেশের ব্যাংক)

1. **Finance → New transaction** → Kind: Expense → Account: "bKash (BDT)"।
2. Amount: যত টাকা গেছে, BDT-তে (যেমন `12000`)।
3. Exchange rate বাক্স আসবে: "1 BDT = ? AUD"। **Use today's rate** চাপলে আজকের বাজার রেট বসে যায় (যেমন `0.0127`)। ব্যাংক বা bKash অন্য রেট দিলে সেটাই লিখুন, বাক্সটা বদলানো যায়।
4. নিচে AUD-এ কত হলো দেখাবে, যেমন "BDT 12,000.00 ≈ $152.40"। ঠিক থাকলে Save।

### (খ) দাম USD-এ, কিন্তু AUD কার্ড দিয়ে পরিশোধ

যেমন একটা টুলের দাম US$20, আপনার অস্ট্রেলিয়ান কার্ড কেটেছে A$31.45 (ব্যাংকের রেট আর ফি সহ)।

1. Account: "AUD card" (AUD)। Amount: **কার্ড স্টেটমেন্টে যা কেটেছে**, অর্থাৎ `31.45`।
2. Description-এ আসল দাম লিখুন, যেমন "Canva Pro, US$20"।
3. এখানে কোনো exchange rate লাগবে না, কারণ account-টাই AUD। কার্ডের আসল খরচ (ফি সহ) ঠিকঠাক হিসাবে থাকে।

### (গ) USD account বা wallet থেকে খরচ (Wise, Payoneer)

1. Account: "Wise USD" (USD)। Amount: USD-এ যত গেছে, যেমন `20`।
2. Exchange rate: "1 USD = ? AUD"। **Use today's rate** চাপুন, বা Wise যে রেট দেখায় সেটা লিখুন।
3. AUD-এর অঙ্ক দেখে Save।

### জেনে রাখুন

- রেট আসে ExchangeRate-API (open.er-api.com) থেকে, দিনে একবার আপডেট হয়, সার্ভার ১২ ঘণ্টা মনে রাখে। শুধু currency code (যেমন `AUD`) পাঠানো হয়, ব্যবসার কোনো তথ্য না। রেট না এলে নিজে লিখে দিন।
- রেট বন্ধ করতে চাইলে সার্ভারের env-এ `FX_PROVIDER=off`। অন্য উৎস যোগ করার জায়গা: `src/server/fx/` আর `src/config/regional.ts`।
- Transfer এখন শুধু একই currency-র দুই account-এর মধ্যে করা যায়।
