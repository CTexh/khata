"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import { clearCache, prefetch, useCached } from "@/lib/swr";
import { HomeIcon, ReceiptIcon, HandshakeIcon, RepeatIcon, SparkleIcon } from "@/components/icons";

type CurrentUser = { id: string; username: string; name?: string | null; isAdmin: boolean };

function EditProfileModal({ initialName, onClose, onSaved }: { initialName: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initialName);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

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
    if (!res.ok) {
      setMsg({ text: "Couldn't save — try again.", bad: true });
      return;
    }
    onSaved();
    onClose();
  };

  return (
    <Sheet title="Edit profile" onClose={onClose}>
      <form onSubmit={save} className="card p-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
            Name
          </span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
        </label>
        {msg && (
          <p className="text-[13px]" style={{ color: msg.bad ? "var(--bad)" : "var(--good)" }} role="status">
            {msg.text}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Sheet>
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
  const { data: me, refresh: refreshMe } = useCached<{ user: CurrentUser | null }>("/api/auth/me");
  const user = me?.user ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const pathname = usePathname();

  // Warm the cache for every tab as soon as the app opens, so switching
  // between Home, Khata, Udhar and Subs never waits on the database.
  useEffect(() => {
    if (!user) return;
    const now = new Date();
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const month = (d: Date) => `year=${d.getFullYear()}&month=${d.getMonth() + 1}`;
    prefetch([
      "/api/people",
      "/api/subscriptions",
      `/api/expenses?${month(now)}`,
      `/api/expenses?${month(prev)}`,
      `/api/expenses/categories?${month(now)}`,
      `/api/expenses/categories?${month(prev)}`,
      "/api/categories",
    ]);
  }, [user]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    clearCache();
    // A full page load rather than a client-side push, so nothing the previous
    // account cached in module state (the shared category list, for one) can
    // outlive the session and be shown to whoever signs in next.
    window.location.href = "/login";
  };

  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const home = pathname === "/";
  const displayName = user?.name || user?.username;

  // The assistant is a full-screen chat with its own top bar and composer.
  if (pathname === "/assistant") {
    return (
      <>
        <a className="skip-link" href="#main-content">Skip to main content</a>
        <main id="main-content">{children}</main>
      </>
    );
  }

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

      {profileOpen && (
        <EditProfileModal initialName={user?.name ?? ""} onClose={closeProfile} onSaved={() => refreshMe()} />
      )}
    </>
  );
}
