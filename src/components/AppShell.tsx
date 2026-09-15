"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar } from "@/components/Avatar";
import { HomeIcon, ReceiptIcon, HandshakeIcon, RepeatIcon, SparkleIcon } from "@/components/icons";

type CurrentUser = { id: string; username: string; name?: string | null; isAdmin: boolean };

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then(async (r): Promise<{ name?: string }> => (r.ok ? r.json() : {}))
      .then((d) => {
        setName(d.name ?? "");
      })
      // A failed load must still clear the spinner, or the form never appears.
      .finally(() => setLoading(false));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setSaving(false);
    setMsg(res.ok ? { text: "Saved." } : { text: "Couldn't save — try again.", bad: true });
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-hidden"
      style={{ background: "rgba(0,0,0,0.6)", overscrollBehavior: "none" }}
      onClick={onClose}
    >
      <div
        className="modal-panel card rise w-full max-w-sm overflow-y-auto"
        style={{ color: "var(--ink)", overscrollBehavior: "contain" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-profile-title"
      >
        <div
          className="flex items-center justify-between p-5 border-b"
          style={{ borderColor: "var(--hairline)" }}
        >
          <h2 id="edit-profile-title" className="text-[16px] font-bold">
            Edit Profile
          </h2>
          <button
            onClick={onClose}
            type="button"
            aria-label="Close"
            className="inline-flex h-10 w-10 items-center justify-center text-[20px] opacity-50 hover:opacity-100 transition"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="p-5 text-[13px]" style={{ color: "var(--muted)" }}>
            Loading…
          </div>
        ) : (
          <form onSubmit={save} className="p-5 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="profile-name" className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
                Name
              </label>
              <input
                id="profile-name"
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>

            {msg && (
              <p className="text-[13px]" style={{ color: msg.bad ? "var(--bad)" : "var(--good)" }} role="status">
                {msg.text}
              </p>
            )}

            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
              <button className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const TITLES: Record<string, string> = {
  "/assistant": "Assistant",
  "/expenses": "Mera Khata",
  "/udhar-khata": "Udhar Khata",
  "/subscriptions": "Subscriptions",
  "/admin": "Admin",
};

const SUBTITLES: Record<string, string> = {
  "/assistant": "Type, talk or snap a bill",
  "/expenses": "Your everyday spending",
  "/udhar-khata": "Who owes you, and how much",
  "/subscriptions": "Every recurring payment",
  "/admin": "Manage accounts",
};

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/expenses", label: "Khata", Icon: ReceiptIcon },
  null, // the Assistant button sits in the middle
  { href: "/udhar-khata", label: "Udhar", Icon: HandshakeIcon },
  { href: "/subscriptions", label: "Subs", Icon: RepeatIcon },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { user: null }))
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    // A full page load rather than a client-side push, so nothing the previous
    // account cached in module state (the shared category list, for one) can
    // outlive the session and be shown to whoever signs in next.
    window.location.href = "/login";
  };

  const home = pathname === "/";
  const displayName = user?.name || user?.username;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div
        className="w-full max-w-xl mx-auto px-4 pt-5 sm:pt-8 flex flex-col gap-5"
        style={{
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
          paddingTop: "max(1.25rem, env(safe-area-inset-top))",
          // room for the floating tab bar
          paddingBottom: "calc(118px + env(safe-area-inset-bottom))",
        }}
      >
        <header className="flex items-center justify-between gap-3 min-h-12">
          <div className="min-w-0">
            {home ? (
              <>
                <p className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
                  Welcome back
                </p>
                <h1 className="text-[22px] font-extrabold leading-tight truncate">
                  {displayName ?? <span className="skeleton align-middle" style={{ width: 120, height: 20 }} />}
                </h1>
              </>
            ) : (
              <>
                <h1 className="text-[24px] font-extrabold leading-tight truncate">
                  {TITLES[pathname] ?? "Khata"}
                </h1>
                {SUBTITLES[pathname] && (
                  <p className="text-[13px] truncate" style={{ color: "var(--muted)" }}>
                    {SUBTITLES[pathname]}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <ThemeToggle />
            {user && (
              <div className="relative">
                <button
                  className="btn btn-ghost !p-0 w-12 h-12"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="Account menu"
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <Avatar id={user.id} name={displayName ?? user.username} size={36} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                    <div className="card absolute right-0 top-14 z-20 p-2 w-52 rise" role="menu">
                      <p className="px-3 py-1.5 text-[13px] font-bold truncate">
                        {user.username}
                        {user.isAdmin && (
                          <span
                            className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                          >
                            ADMIN
                          </span>
                        )}
                      </p>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setProfileOpen(true);
                        }}
                        className="w-full min-h-12 flex items-center px-3 py-1.5 rounded-xl text-[14px] cursor-pointer hover:bg-[var(--surface-2)]"
                      >
                        Edit Profile
                      </button>
                      {user.isAdmin && (
                        <Link
                          href="/admin"
                          role="menuitem"
                          onClick={() => setMenuOpen(false)}
                          className="w-full min-h-12 flex items-center px-3 py-1.5 rounded-xl text-[14px] hover:bg-[var(--surface-2)]"
                        >
                          Admin
                        </Link>
                      )}
                      <button
                        onClick={logout}
                        role="menuitem"
                        className="w-full min-h-12 text-left px-3 py-1.5 rounded-xl text-[14px] cursor-pointer hover:bg-[var(--surface-2)]"
                        style={{ color: "var(--bad)" }}
                      >
                        Log out
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </header>

        <main id="main-content" className="contents">{children}</main>
      </div>

      <nav className="tabbar" aria-label="Primary navigation">
        {TABS.map((tab) =>
          tab === null ? (
            <Link
              key="assistant"
              href="/assistant"
              className="tab-fab"
              aria-label="Assistant"
              aria-current={pathname === "/assistant" ? "page" : undefined}
            >
              <SparkleIcon size={28} />
            </Link>
          ) : (
            <Link
              key={tab.href}
              href={tab.href}
              className="tab"
              aria-current={pathname === tab.href ? "page" : undefined}
            >
              <tab.Icon size={22} />
              <span>{tab.label}</span>
            </Link>
          )
        )}
      </nav>

      {profileOpen && <EditProfileModal onClose={() => setProfileOpen(false)} />}
    </>
  );
}
