# Deployment (one VPS)

OmniSuite runs as three containers on one Linux VPS: **Postgres**, the **app** (Next.js server with the background worker inside it) and **Caddy** (HTTPS, including on-demand certificates for verified tenant domains). Two small containers take a nightly `pg_dump` and copy it (and uploaded files) to Cloudflare R2.

## 1. Server

- Ubuntu 24.04 LTS or newer, 2 vCPU / 4 GB RAM is plenty to start.
- Install Docker Engine and the compose plugin.
- Open ports 80 and 443 only (plus SSH).

## 2. DNS (Cloudflare)

| Record                               | Value                      | Proxy                                   |
| ------------------------------------ | -------------------------- | --------------------------------------- |
| `A app.omniscopedigital.com`         | VPS IP                     | DNS only (grey cloud) so Caddy gets TLS |
| `CNAME tenants.omniscopedigital.com` | `app.omniscopedigital.com` | DNS only                                |

Businesses that want their own address add `CNAME portal.theirdomain.com → tenants.omniscopedigital.com` and the TXT record shown in **Settings → Domains**.

## 3. Google OAuth

In the Google Cloud project (OAuth client, type "Web application"):

- Authorised JavaScript origin: `https://app.omniscopedigital.com`
- Redirect URIs:
  - `https://app.omniscopedigital.com/api/auth/callback/google` (sign-in)
  - `https://app.omniscopedigital.com/api/google/callback` (Drive backup)
- Enable the **Google Drive API** and **Google Sheets API**. The app asks only for `drive.file` (it sees only files it creates).

## 4. Configure and start

```bash
git clone https://github.com/mdraselswe/omni-suite.git && cd omni-suite
cp .env.example .env.production   # then edit it
```

In `.env.production` set at least: `APP_URL=https://app.omniscopedigital.com`, `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY` (both random, see the comments), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PLATFORM_ADMIN_EMAILS`, `SMTP_URL` and `MAIL_FROM` (a real SMTP service), `CUSTOM_DOMAIN_TARGET=tenants.omniscopedigital.com`, `DEV_LOGIN=false`.

Create a `.env` next to the compose file for compose itself:

```bash
POSTGRES_PASSWORD=<long random password>
# The same two values as in .env.production: compose refuses to start without them,
# and the app refuses to start in production with the public development defaults.
BETTER_AUTH_SECRET=<same as .env.production>
ENCRYPTION_KEY=<same as .env.production>
APP_HOST=app.omniscopedigital.com
ACME_EMAIL=<email for Let's Encrypt notices>
# Off-server backups to Cloudflare R2 (optional; leave empty to turn off)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=omnisuite-backups
R2_KEEP_DAYS=60
```

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run when the app starts. Sign in with Google using a platform admin email, then create the first business at `/onboarding`.

## 5. Updates

```bash
git pull && docker compose -f docker-compose.prod.yml up -d --build app
```

## 6. Backups

- **Database:** the `db-backup` container writes `omnisuite-YYYY-MM-DD.dump` daily into the `backups` volume and keeps 14 days. The `offsite-backup` container copies them to Cloudflare R2 every night once `R2_*` is set (dumps kept `R2_KEEP_DAYS`, default 60). Restore: `pg_restore -c -d omnisuite file.dump`.
- **Uploaded files:** the `files` volume (`/app/storage`), copied to R2 by the same container (files are only ever added there).
- **Check it:** `docker compose -f docker-compose.prod.yml logs offsite-backup` shows `offsite-backup: done …` each night. Set-up steps (Bangla): `docs/setup-guide-bn.md`.
- **Google Sheets / Drive JSON:** per business, one-way copies for people and portability (ADR 0007). Not a replacement for the two above.

## Moving to another domain later

Nothing is hard-coded: change `APP_URL`, `APP_HOST`, the Google OAuth origins/redirects and DNS, then restart. Existing custom tenant domains keep working; their CNAME target is `CUSTOM_DOMAIN_TARGET`.
