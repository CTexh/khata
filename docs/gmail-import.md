# Reading bank alerts into Khata

Expenses appear in Mera Khata on their own because Khata reads the alert emails
the banks send. It does this itself, as part of `/api/cron/run` - the same call
cron-job.org already makes every fifteen minutes. Nothing outside the app is
involved.

A run:

1. searches Gmail for mail from the three banks since the last run (an hour
   further back as well, because alerts sometimes arrive late);
2. asks the database which of those emails no run has dealt with - usually
   none, and then the run stops here having read nothing;
3. fetches only the new ones and asks Gemini, in one request for the batch,
   what each is: an expense, or a skip with a reason;
4. checks every answer (`src/lib/email-rules.ts`), then hands them to the same
   code the old cloud routine posted to - duplicate checks, deletion
   tombstones, categorisation and notifications all unchanged.

An email is marked as dealt with only once it has become an expense or a
recorded skip, so a failed run loses nothing: the next one covers the same
ground. `/api/cron/gmail` runs just the import, for when a payment has not
turned up and the question is why.

## Setup, once

Khata needs read-only access to the mailbox. Three environment variables:
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. Without them
the import reports "not configured" and the rest of the cron keeps working.

1. **A Google Cloud project.** <https://console.cloud.google.com/projectcreate> -
   any name.
2. **Switch on the Gmail API.** APIs & Services > Library > Gmail API >
   Enable.
3. **The consent screen.** APIs & Services > OAuth consent screen. User type
   *External*; fill in the app name and your own email. Under *Audience*, add
   your own Google account as a test user. It never needs verifying or
   publishing - a test user's access is enough, and the refresh token does not
   expire while the account is listed there.
4. **A client.** Credentials > Create credentials > OAuth client ID > type
   **Desktop app**. Copy the client ID and secret.
5. **Mint the refresh token** on your own machine:

   ```bash
   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/gmail-authorize.mjs
   ```

   It prints a link. Approve it in the browser (Google warns that the app is
   unverified - it is your own), and the refresh token is printed in the
   terminal.
6. **Put all three in Vercel**, Production, then redeploy. The next cron call
   imports.

The scope is `gmail.readonly`: Khata can read mail and nothing else - it cannot
send, delete or change anything. Access can be withdrawn at any time from
<https://myaccount.google.com/permissions>, which stops the import immediately.

## The rules

`src/lib/email-rules.ts` holds the parts that are specific to this mailbox, and
editing that file is how they change:

- `BANK_SENDERS` - the domains that are searched. Nothing else is ever fetched.
- `OWN_ACCOUNTS` - names that mean money moved between the account holder's own
  accounts, which is not spending. Matched against the payee read out of the
  alert, never the whole email: the account holder's own name is in the
  greeting of every one of them.
- `EXCLUDED_MERCHANTS` - subscriptions, which have their own screen and reach
  Mera Khata as one expense at month end, so their bank alerts must not become
  a second one.

Both lists are applied again after the model has answered, so they have the
last word whatever it decided. Anything it cannot read - no amount, no date, a
date in the future - is skipped with a reason starting `attention:`, recorded
against the email so it is not read again, and visible in the response of
`/api/cron/gmail`.

After changing either list or the prompt, check the decisions against a set of
alerts in the shape the banks send, without touching Gmail or the ledger:

```bash
node --experimental-strip-types --env-file=.env.local \
  --import ./scripts/alias-register.mjs scripts/try-email-decisions.ts
```

`npm test` covers the rest: the rules themselves, and a whole run against a
throwaway database with Gmail and the model answered locally
(`scripts/test-gmail-sync-db.ts`).

## Checking on it

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" https://khata-delta.vercel.app/api/cron/gmail
```

`state` is `imported`, `nothing new`, `not configured` or `failed`. A failure
says why; `models busy` and a Gmail error both mean the next run tries again.
`left_for_next_run` above zero means an outage left a backlog, which drains a
dozen emails at a time.

Vercel's logs carry one line per import, `evt: "gmail_sync"`.
