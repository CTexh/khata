"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar } from "@/components/Avatar";

type CurrentUser = { id: string; username: string; isAdmin: boolean };

function EditProfileModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then(async (r): Promise<{ name?: string; phone?: string }> => (r.ok ? r.json() : {}))
      .then((d) => {
        setName(d.name ?? "");
        setPhone(d.phone ?? "");
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
      body: JSON.stringify({ name, phone }),
    });
    setSaving(false);
    setMsg(res.ok ? { text: "Saved." } : { text: "Couldn't save — try again.", bad: true });
  };

  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center overflow-hidden backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.75)", overscrollBehavior: "none" }}
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
          <h2 id="edit-profile-title" className="text-[16px] font-semibold">
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
              <label className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
                Name
              </label>
              <input
                className="field"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[12px] font-medium" style={{ color: "var(--muted)" }}>
                WhatsApp number
              </label>
              <input
                className="field"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+923001234567"
              />
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                Used for subscription reminders and expense reports.
              </p>
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

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: "" },
  { href: "/expenses", label: "Mera Khata", icon: "" },
  { href: "/udhar-khata", label: "Udhar Khata", icon: "" },
  { href: "/subscriptions", label: "Subscriptions", icon: "" },
];

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

  const items = user?.isAdmin
    ? [...NAV_ITEMS, { href: "/admin", label: "Admin", icon: "" }]
    : NAV_ITEMS;

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div
        className="w-full max-w-xl mx-auto px-4 py-6 sm:py-10 flex flex-col gap-5"
        style={{
          paddingLeft: "max(1rem, env(safe-area-inset-left))",
          paddingRight: "max(1rem, env(safe-area-inset-right))",
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
      <header className="flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3 min-w-0">
          <Logo />
          <div className="min-w-0">
            <h1 className="wordmark text-[26px] leading-tight">Khata</h1>
            <p className="text-[13px] truncate" style={{ color: "var(--muted)" }}>
              Your money, sorted
            </p>
          </div>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          {user && (
            <div className="relative">
              <button
                className="btn btn-ghost !p-0 w-10 h-10"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="Account menu"
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <Avatar id={user.id} name={user.username} size={32} />
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="card absolute right-0 top-12 z-20 p-2 w-48 rise" role="menu">
                    <p className="px-3 py-1.5 text-[13px] font-semibold truncate">
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
                      className="w-full min-h-12 flex items-center px-3 py-1.5 rounded-lg text-[13px] cursor-pointer"
                    >
                      Edit Profile
                    </button>
                    <button
                      onClick={logout}
                      role="menuitem"
                      className="w-full min-h-12 text-left px-3 py-1.5 rounded-lg text-[13px] cursor-pointer"
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

      {pathname !== "/" && (
        <nav className="nav-scroll flex items-center gap-2 overflow-x-auto" aria-label="Primary navigation">
          {items
            .filter((item) => item.href !== "/")
            .map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`btn shrink-0 !py-2 !px-4 ${active ? "btn-primary" : "btn-ghost"}`}
                >
                  {item.icon && <span>{item.icon}</span>}
                  <span>{item.label}</span>
                </Link>
              );
            })}
        </nav>
      )}

        <main id="main-content" className="contents">{children}</main>
      </div>
      {profileOpen && <EditProfileModal onClose={() => setProfileOpen(false)} />}
    </>
  );
}
