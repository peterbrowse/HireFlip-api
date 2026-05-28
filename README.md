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

## Next API Work

The next step is to rebuild the MVP content model against the roadmap, starting with audit logs and the core candidate/class/course entities.
