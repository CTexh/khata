"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { ThemePicker } from "@/components/Theme";
import { PushSettings } from "@/components/PushSettings";
import { Avatar } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";
import { WelcomeTour } from "@/components/WelcomeTour";
import { clearCache, primeFrom, useCached } from "@/lib/swr";
import { HomeIcon, ReceiptIcon, HandshakeIcon, RepeatIcon, SparkleIcon } from "@/components/icons";

type CurrentUser = {
  id: string;
  username: string;
  name?: string | null;
  isAdmin: boolean;
  aiAccess?: boolean;
  createdAt?: string | null;
};

type EmailPrefs = {
  subscriptions: boolean;
  udhar: boolean;
  dailyRecap: boolean;
  monthlySummary: boolean;
};

const ALL_PREFS: EmailPrefs = { subscriptions: true, udhar: true, dailyRecap: true, monthlySummary: true };

// One line per kind of email, in the order they reach you during a day.
const EMAIL_KINDS: { key: keyof EmailPrefs; title: string; hint: string }[] = [
  {
    key: "subscriptions",
    title: "Subscriptions due",
    hint: "6pm the day before, and again on the day if it's still unpaid.",
  },
  { key: "udhar", title: "Udhar follow-ups", hint: "6pm on the date you set for someone who owes you." },
  { key: "dailyRecap", title: "Daily recap", hint: "4:30am, covering the day just gone - and what you may have forgotten." },
  { key: "monthlySummary", title: "Monthly summary", hint: "On the 1st, what last month cost you." },
];

function Switch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 min-h-11 cursor-pointer">
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{label}</span>
        {hint && (
          <span className="block text-[12.5px] mt-0.5" style={{ color: "var(--muted)" }}>
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        className="h-6 w-6 mt-0.5 shrink-0 accent-[var(--accent)] cursor-pointer"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function SettingsModal({
  initialName,
  isAdmin,
  onClose,
  onSaved,
}: {
  initialName: string;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState("");
  const [reminders, setReminders] = useState(true);
  const [prefs, setPrefs] = useState<EmailPrefs>(ALL_PREFS);
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setName(d.name ?? "");
        setEmail(d.email ?? "");
        setReminders(d.emailReminders !== false);
        setPrefs({ ...ALL_PREFS, ...(d.prefs ?? {}) });
        setAvailable(d.emailAvailable !== false);
      })
      .finally(() => setLoaded(true));
  }, []);

  const persist = async (): Promise<boolean> => {
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, emailReminders: reminders, prefs }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg({ text: j.error ?? "Couldn't save — try again.", bad: true });
      return false;
    }
    return true;
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const ok = await persist();
    setSaving(false);
    if (!ok) return;
    onSaved();
    onClose();
  };

  // Without an address there is nothing to send to, so the switches are shown
  // but inert until one is typed.
  const emailable = loaded && Boolean(email.trim());

  return (
    <Sheet title="Settings" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="card p-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
              Name
            </span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" />
          </label>
        </div>

        <div className="card p-4 flex flex-col gap-3">
          <div>
            <p className="text-[15px] font-bold">Appearance</p>
            <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
              System follows your phone&apos;s light or dark setting.
            </p>
          </div>
          <ThemePicker />
        </div>

        {/* Notifications on the phone itself are being tried on admin
            accounts first; everyone else has the email reminders. */}
        {isAdmin && <PushSettings />}

        <div className="card p-4 flex flex-col gap-3">
          <div>
            <p className="text-[15px] font-bold">Email notifications</p>
            <p className="text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
              Where reminders are sent. Pick the ones you want below.
            </p>
          </div>
          <input
            className="field"
            type="email"
            inputMode="email"
            autoComplete="email"
            aria-label="Email address"
            placeholder="you@example.com"
            value={email}
            disabled={!loaded}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Switch
            label="Send me emails"
            hint="Off means none of the below are sent."
            checked={reminders}
            disabled={!emailable}
            onChange={setReminders}
          />
          {reminders && (
            <div className="flex flex-col gap-3 pt-3" style={{ borderTop: "1px solid var(--ring)" }}>
              {EMAIL_KINDS.map((kind) => (
                <Switch
                  key={kind.key}
                  label={kind.title}
                  hint={kind.hint}
                  checked={prefs[kind.key]}
                  disabled={!emailable}
                  onChange={(v) => setPrefs((p) => ({ ...p, [kind.key]: v }))}
                />
              ))}
            </div>
          )}
          {!available && (
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>
              Email sending isn&apos;t switched on yet - your address is saved for when it is.
            </p>
          )}
        </div>

        {msg && (
          <p className="text-[13px] px-1" style={{ color: msg.bad ? "var(--bad)" : "var(--good)" }} role="status">
            {msg.text}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={saving || !loaded}>
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

// Everything the tabs show when the app opens comes from one request instead
// of eight. Started during the first render - before any page's effects run -
// so the pages' own requests for these keys wait for it rather than racing it.
let primed = false;
function primeAppData() {
  if (primed || typeof window === "undefined") return;
  primed = true;
  const now = new Date();
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = (d: Date) => `year=${d.getFullYear()}&month=${d.getMonth() + 1}`;
  primeFrom(`/api/bootstrap?y=${now.getFullYear()}&m=${now.getMonth() + 1}`, [
    "/api/auth/me",
    "/api/people",
    "/api/subscriptions",
    `/api/expenses?${month(now)}`,
    `/api/expenses?${month(prev)}`,
    `/api/expenses/categories?${month(now)}`,
    `/api/expenses/categories?${month(prev)}`,
    "/api/categories",
  ]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  primeAppData();
  const { data: me, refresh: refreshMe } = useCached<{ user: CurrentUser | null }>("/api/auth/me");
  const user = me?.user ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const pathname = usePathname();


  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    clearCache();
    // A full page load rather than a client-side push, so nothing the previous
    // account cached in module state (the shared category list, for one) can
    // outlive the session and be shown to whoever signs in next.
    window.location.href = "/login";
  };

  const closeProfile = useCallback(() => setProfileOpen(false), []);

  // A new account (made in the last two weeks) sees the welcome tour once on
  // this device. It can be skipped, and replayed from the account menu.
  const [tourOpen, setTourOpen] = useState(false);
  const tourKey = user ? `khata-tour-done:${user.id}` : null;
  useEffect(() => {
    if (!user || !tourKey) return;
    const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
    if (!Number.isFinite(created) || Date.now() - created > 14 * 24 * 60 * 60 * 1000) return;
    try {
      if (!localStorage.getItem(tourKey)) setTourOpen(true);
    } catch {}
  }, [user, tourKey]);
  const closeTour = useCallback(() => {
    setTourOpen(false);
    try {
      if (tourKey) localStorage.setItem(tourKey, "1");
    } catch {}
  }, [tourKey]);
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
                        Settings
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          setTourOpen(true);
                        }}
                        className="w-full min-h-12 flex items-center px-3 py-1.5 rounded-xl text-[14px] cursor-pointer hover:bg-[var(--surface-2)]"
                      >
                        Welcome tour
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

      <nav className={`tabbar${user?.aiAccess ? "" : " no-fab"}`} aria-label="Primary navigation">
        {TABS.map((tab) =>
          tab === null ? (
            // Only for accounts with assistant access (admins, or switched on in Admin).
            !user?.aiAccess ? null : 
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

      {tourOpen && user && <WelcomeTour withAssistant={Boolean(user.aiAccess)} onClose={closeTour} />}

      {profileOpen && (
        <SettingsModal
          initialName={user?.name ?? ""}
          isAdmin={Boolean(user?.isAdmin)}
          onClose={closeProfile}
          onSaved={() => refreshMe()}
        />
      )}
    </>
  );
}
