import { NextResponse, after } from "next/server";
import { getSession } from "@/lib/auth";
import { deletePushSubscription, getPushDevice, listPushSubscriptions, savePushSubscription } from "@/lib/db";
import { pushConfigured, pushPublicKey } from "@/lib/push";
import { deliverPending } from "@/lib/notify";

export const dynamic = "force-dynamic";

// Notifications are how Khata reminds anyone of anything, so every account
// can register its own devices.
async function signedIn() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  return { session };
}

// What the page needs to offer the switch: whether the server can send at all,
// the key a browser needs to subscribe, and how many devices are registered.
// Given this device's endpoint, also whether the server still has it and how
// delivery to it has been going - for the health line in Settings, and so the
// app can tell when iOS has quietly dropped its registration.
export async function GET(req: Request) {
  const { session, error } = await signedIn();
  if (error) return error;
  const devices = pushConfigured() ? await listPushSubscriptions(session.userId) : [];
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  const device = endpoint ? await getPushDevice(session.userId, endpoint) : null;
  return NextResponse.json(
    {
      available: pushConfigured(),
      publicKey: pushPublicKey(),
      devices: devices.length,
      thisDevice: endpoint
        ? {
            registered: Boolean(device),
            lastDeliveredAt: device?.lastDeliveredAt ?? null,
            lastError: device?.lastError ?? null,
            lastErrorAt: device?.lastErrorAt ?? null,
          }
        : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

// A device subscribing. The endpoint is its address with its own push
// service; the keys encrypt what we send so only that device can read it.
export async function POST(req: Request) {
  const { session, error } = await signedIn();
  if (error) return error;
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Notifications aren't switched on yet." }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 1000 || !p256dh || !auth) {
    return NextResponse.json({ error: "That subscription doesn't look right." }, { status: 400 });
  }

  await savePushSubscription(session.userId, { endpoint, p256dh, auth });
  // Anything that piled up in the outbox while this account had no working
  // device is delivered now, not at the next scheduled run.
  const userId = session.userId;
  after(() => deliverPending({ userId }).then(() => undefined).catch(() => undefined));
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const { session, error } = await signedIn();
  if (error) return error;
  const endpoint = new URL(req.url).searchParams.get("endpoint") ?? "";
  if (endpoint) await deletePushSubscription(endpoint, session.userId);
  return NextResponse.json({ success: true });
}
