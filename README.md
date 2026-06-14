# HireFlip API

Core Strapi API for HireFlip.

This repo has been reset to a clean Strapi 5 baseline. The previous broken API attempt is preserved on the backup branch:

`backup/pre-api-reset-2026-05-28`

## Stack

- Strapi 5
- TypeScript
- PostgreSQL for deployed environments
- SQLite for local development if `DATABASE_CLIENT` is left as `sqlite`
- AWS S3 for private product file storage
- Cloudinary later for public image/video optimisation and transformations

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run develop
```

Generate local secrets with:

```bash
openssl rand -base64 32
```

Never commit `.env` or `.env.local` files.

Local development scripts load `.env.local` by default through Strapi's `ENV_PATH` setting. Heroku should use config vars instead of an env file.

## Useful Commands

```bash
npm run develop
npm run build
npm run start
npm run seed:admin-roles
```

`npm run seed:admin-roles` creates or updates the custom Strapi admin/staff
roles required by `HireFlip-admin-dashboard`: Admin, Sales, and Support. It is
idempotent and safe to run locally or as a first-run remote setup command.

Remote first-run setup:

```bash
heroku run "npm run seed:admin-roles" --app hireflip-api
```

## Storage Direction

Private product files should use S3:

- generated CV PDFs
- course materials and downloads
- candidate activity reports
- privacy/data-export bundles
- assessment appeal and dispute attachments

Local development can use Strapi's local upload provider by setting `UPLOAD_PROVIDER=local`.

Deployed environments should set `UPLOAD_PROVIDER=aws-s3` and provide the AWS S3 environment variables from `.env.example`.

The production bucket should be a modern private S3 bucket with Object
Ownership set to bucket-owner-enforced and ACLs disabled. Leave `AWS_ACL` blank
for that setup so the API does not send ACL headers. Keep
`AWS_S3_SIGNED_URLS=true` so Strapi signs Media Library preview/download URLs
for the private bucket. Only set `AWS_ACL` if the bucket is deliberately
configured to accept ACLs later.

## Strapi System Email

Strapi system emails should eventually route through `HireFlip-notification-service`,
not directly through SendGrid from the API.

The API includes an env-gated custom Strapi email provider for that handoff.
Leave it disabled until the notification service exposes the matching internal
email endpoint.

```bash
STRAPI_EMAIL_PROVIDER=notification-service
NOTIFICATION_SERVICE_URL=https://your-notification-service.example.com
NOTIFICATION_SERVICE_TOKEN=...
STRAPI_EMAIL_DEFAULT_FROM=no-reply@hireflip.work
STRAPI_EMAIL_DEFAULT_REPLY_TO=support@hireflip.work
```

The provider posts rendered Strapi system emails to
`/api/internal/notifications/email` with the `core-api` service identity.

## Public Interest Protection

The public interest capture endpoint is intended to be called by the homepage
server, not directly by browsers.

Required deployed config:

```bash
TURNSTILE_SECRET_KEY=...
TURNSTILE_ALLOWED_HOSTNAMES=hireflip.work
SERVICE_TOKEN_SHA256_HASHES=...
```

`TURNSTILE_SECRET_KEY` is the private Cloudflare Turnstile key used for
server-side token validation. `SERVICE_TOKEN_SHA256_HASHES` should contain
SHA-256 hashes of service tokens, not raw token values. The homepage sends the
raw token server-side using `x-hireflip-service-token`.

The Turnstile widget should be configured for Cloudflare-owned hostnames only.
The launch hostname is `hireflip.work`. If a preview environment needs
Turnstile later, create a Cloudflare-owned preview hostname such as
`preview.hireflip.work` and add it to both the Turnstile widget and
`TURNSTILE_ALLOWED_HOSTNAMES`.

For local automated testing, Cloudflare's official always-pass dummy secret can
be used:

```bash
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

## Next API Work

The next step is to rebuild the MVP content model against the roadmap, starting with audit logs and the core candidate/class/course entities.
