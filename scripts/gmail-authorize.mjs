// Makes the refresh token the app needs to read bank alert emails.
//
// Run once, on your own machine:
//
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/gmail-authorize.mjs
//
// It prints a link, waits for you to approve it in the browser, and prints the
// refresh token to put in Vercel as GMAIL_REFRESH_TOKEN. The token is read-only
// and covers Gmail alone - it cannot send, delete or change anything.
//
// The client id and secret come from a Google Cloud OAuth client of type
// "Desktop app", with the Gmail API switched on. See docs/gmail-import.md.
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const clientId = process.env.GMAIL_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first.");
  process.exit(1);
}

const PORT = Number(process.env.PORT || 7771);
const redirectUri = `http://127.0.0.1:${PORT}`;
const scope = "https://www.googleapis.com/auth/gmail.readonly";
// Guards against another page on your machine calling this server.
const state = randomBytes(16).toString("hex");

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    // Without both of these Google returns an access token only, and the app
    // needs one it can keep using.
    access_type: "offline",
    prompt: "consent",
    state,
  });

const page = (title, detail) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
  `<body style="font:16px system-ui;padding:3rem;max-width:34rem"><h1>${title}</h1><p>${detail}</p></body>`;

const done = (server, code) =>
  new Promise((resolve) => {
    server.close(() => resolve(code));
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.writeHead(400, { "content-type": "text/html" }).end(page("Not authorised", error));
    console.error(`Google returned: ${error}`);
    await done(server);
    process.exit(1);
  }
  if (!code) {
    res.writeHead(404, { "content-type": "text/html" }).end(page("Waiting", "Open the link printed in the terminal."));
    return;
  }
  if (url.searchParams.get("state") !== state) {
    res.writeHead(400, { "content-type": "text/html" }).end(page("Not authorised", "The state did not match."));
    console.error("state mismatch - start again");
    await done(server);
    process.exit(1);
  }

  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  }).then((r) => r.json());

  if (!token.refresh_token) {
    res
      .writeHead(400, { "content-type": "text/html" })
      .end(page("No refresh token", "Remove this app's access at myaccount.google.com/permissions and run it again."));
    console.error("No refresh_token came back:", JSON.stringify(token).slice(0, 400));
    await done(server);
    process.exit(1);
  }

  res
    .writeHead(200, { "content-type": "text/html" })
    .end(page("Khata can read your bank alerts", "The refresh token is in your terminal. You can close this tab."));

  console.log("\nGMAIL_REFRESH_TOKEN=%s\n", token.refresh_token);
  console.log("Add that to Vercel (Production), along with GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.");
  await done(server);
  process.exit(0);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Open this link and approve read-only access to Gmail:\n");
  console.log(authUrl);
  console.log("\nWaiting on %s ...", redirectUri);
});
