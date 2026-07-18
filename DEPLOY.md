# Deploying Khata to Vercel

## 1. Create a Turso Database (Cloud SQLite)

**Turso** is a free hosted SQLite service perfect for Khata. It keeps your data in sync across all devices.

1. Go to https://turso.tech and sign up (free tier is generous)
2. Create a new database:
   ```bash
   turso db create khata
   ```
3. Get your connection details:
   ```bash
   turso db show khata
   ```
   You'll see:
   - **URL**: `libsql://your-db-name-hash.turso.io`
   - **Token**: `edxxxxxx...`

4. Copy these — you'll paste them into Vercel next.

## 2. Deploy to Vercel

1. Go to https://vercel.com and log in with GitHub
2. Click **Add New → Project**
3. Select the **khata** repository
4. Configure the project:
   - **Framework Preset**: Next.js (auto-detected)
   - Leave **Build & Output** settings as default
5. Before deploying, add environment variables:
   - Click **Environment Variables**
   - Add two variables from your Turso database:
     - `TURSO_DATABASE_URL` = (paste your Turso URL from step 1)
     - `TURSO_AUTH_TOKEN` = (paste your Turso token from step 1)
6. Click **Deploy**

That's it! Vercel will build and host your app. Your data will sync across all your devices (phone, laptop, tablet).

## 3. Test the Deployment

Once live:
- Open your Vercel deployment URL
- Add a borrower
- Open on your phone — the record appears instantly (synced via Turso)
- Toggle dark mode — preference persists
- Records persist across refreshes and devices

## Environment Variables Reference

| Variable | Where to get it |
|---|---|
| `TURSO_DATABASE_URL` | Turso dashboard → Database → URL |
| `TURSO_AUTH_TOKEN` | Turso dashboard → Database → Token |

## Troubleshooting

**"Database connection failed"**
- Check the environment variables are pasted correctly (no extra spaces)
- Verify your Turso token hasn't expired

**"Data not syncing"**
- Confirm the URL and token match the Turso database you created

## Local Development

To run locally with your Turso database:

1. Create `.env.local`:
   ```
   TURSO_DATABASE_URL=libsql://...
   TURSO_AUTH_TOKEN=edxxxx...
   ```

2. Run:
   ```bash
   npm run dev
   ```

3. Open http://localhost:3000
