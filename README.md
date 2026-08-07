# Khata

A responsive ledger and expense tracker built with Next.js and Turso/libSQL.

## Local development

Create `.env.local` with the required application secrets, then initialize the database and start the app:

```bash
npm install
npm run db:migrate
npm run dev
```

The database uses `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Without a URL, development falls back to `local.db`.

Optional `ADMIN_USERNAME` and `ADMIN_PASSWORD` values create the initial admin account. Existing admin passwords are never overwritten by migrations.

## Database changes

Run migrations explicitly after changing the schema and before deploying:

```bash
npm run db:migrate
```

Migrations are intentionally kept out of request handling so serverless cold starts do not perform schema writes or password hashing.

## Verification

```bash
npm run build
```
