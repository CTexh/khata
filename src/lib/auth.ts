import { cookies } from "next/headers";
import crypto from "crypto";

const SESSION_COOKIE = "khata_session";
const SESSION_DAYS = 30;

function secret(): string {
  return process.env.AUTH_SECRET ?? "khata-dev-secret-change-in-production";
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(candidate, "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export type SessionPayload = {
  userId: string;
  username: string;
  isAdmin: boolean;
  exp: number;
};

function sign(payload: SessionPayload): string {
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

function verify(token: string): SessionPayload | null {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac("sha256", secret()).update(b64).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString()) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function createSession(user: { id: string; username: string; is_admin: boolean }) {
  const payload: SessionPayload = {
    userId: user.id,
    username: user.username,
    isAdmin: user.is_admin,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
  const token = sign(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verify(token);
}

export function verifyToken(token: string): SessionPayload | null {
  return verify(token);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
