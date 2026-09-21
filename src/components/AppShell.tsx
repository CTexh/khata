"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { Switch } from "@/components/Switch";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Avatar } from "@/components/Avatar";
import { Sheet } from "@/components/Sheet";

import { NotificationBell } from "@/components/NotificationBell";
import { clearCache, primeFrom, useCached } from "@/lib/swr";
import { send } from "@/lib/submit";
import { HomeIcon, ReceiptIcon, HandshakeIcon, RepeatIcon, SparkleIcon, SuitcaseIcon } from "@/components/icons";

// None of this is reachable without opening the avatar menu, and together it
// was about 10 KB of JavaScript on every page load - the whole settings
// surface, including the Siri setup guide, downloaded by people who never
// open it. Fetched when it is actually needed instead.
const ThemePicker = dynamic(() => import("@/components/Theme").then((m) => m.ThemePicker));
const NotificationSettings = dynamic(() =>
  import("@/components/NotificationSettings").then((m) => m.NotificationSettings)
);
const SiriSettings = dynamic(() => import("@/components/SiriSettings").then((m) => m.SiriSettings));
const WelcomeTour = dynamic(() => import("@/components/WelcomeTour").then((m) => m.WelcomeTour));
const NotificationsNews = dynamic(() => import("@/components/NotificationsNews").then((m) => m.NotificationsNews));

type CurrentUser = {
  id: string;
  username: string;
  name?: string | null;
  isAdmin: boolean;
  aiAccess?: boolean;
  tripsEnabled?: boolean;
  createdAt?: string | null;
};

function SettingsModal({
  initialName,
  startOnNotifications,
  withAssistant,
  onClose,
  onSaved,
}: {
  initialName: string;
  startOnNotifications?: boolean;
  // Siri only reaches the assistant, so it is only offered to accounts that
  // have one. The token endpoint refuses the rest anyway; there is no reason
  // to show them a door that does not open.
  withAssistant: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notifications, setNotifications] = useState(Boolean(startOnNotifications));
  const [siri, setSiri] = useState(false);
  const [trips, setTrips] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setName(d.name ?? "");
          setTrips(Boolean(d.tripsEnabled));
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    const sent = await send("/api/profile", { method: "PATCH", body: { name, tripsEnabled: trips } });
    setSaving(false);
    if (!sent.ok) {
      setMsg({ text: sent.error, bad: true });
      return;
    }
    onSaved();
    onClose();
  };

  // Notifications get a screen of their own: what they are is one decision,
  // which ones you want is another.
  if (notifications)
    return <NotificationSettings onBack={() => (startOnNotifications ? onClose() : setNotifications(false))} />;
  if (siri) return <SiriSettings onBack={() => setSiri(false)} />;

  return (
    <Sheet title="Settings" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="card p-4 flex flex-col gap-3">
          <p className="text-[15px] font-bold">Profile</p>
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

        <div className="card p-4 flex flex-col gap-3">
          <p className="text-[15px] font-bold">Sections</p>
          <Switch
            label="Trips"
            hint="Split a group trip's costs between everyone and settle up at the end."
            checked={trips}
            onChange={setTrips}
          />
        </div>

        <button
          type="button"
          className="card p-4 w-full text-left flex items-center gap-3"
          onClick={() => setNotifications(true)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">Manage notifications</span>
            <span className="block text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
              Which reminders you get, and on which devices.
            </span>
          </span>
          <span style={{ color: "var(--muted)" }} aria-hidden>
            ›
          </span>
        </button>

        {withAssistant && (
        <button
          type="button"
          className="card p-4 w-full text-left flex items-center gap-3"
          onClick={() => setSiri(true)}
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold">Siri &amp; Shortcuts</span>
            <span className="block text-[13px] mt-0.5" style={{ color: "var(--muted)" }}>
              Speak to the assistant without opening the app.
            </span>
          </span>
          <span style={{ color: "var(--muted)" }} aria-hidden>
            ›
          </span>
        </button>
        )}

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
  "/trips": "Trips",
  "/admin": "Admin",
};

const SUBTITLES: Record<string, string> = {
  "/assistant": "Type, talk or snap a bill",
  "/expenses": "Your everyday spending",
  "/udhar-khata": "Who owes you, and how much",
  "/subscriptions": "Every recurring payment",
  "/trips": "Split a trip, settle up at the end",
  "/admin": "Manage accounts",
};

const TABS = [
  { href: "/", label: "Home", Icon: HomeIcon },
  { href: "/expenses", label: "Khata", Icon: ReceiptIcon },
  // Only for accounts that switched Trips on in Settings.
  { href: "/trips", label: "Trips", Icon: SuitcaseIcon, optional: "trips" },
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
    "/api/trips",
    "/api/subscriptions",
    `/api/expenses?${month(now)}`,
    `/api/expenses?${month(prev)}`,
    `/api/expenses/categories?${month(now)}`,
    `/api/expenses/categories?${month(prev)}`,
    "/api/categories",
    "/api/notifications",
  ]);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  primeAppData();
  const { data: me, refresh: refreshMe } = useCached<{ user: CurrentUser | null }>("/api/auth/me");
  const user = me?.user ?? null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState<false | "settings" | "notifications">(false);
  const pathname = usePathname();
  // A page inside a section - /trips/<id> - carries the section's heading.
  const section = pathname.startsWith("/trips/") ? "/trips" : pathname;


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
  // this device, and nowhere else - it is for someone opening the app for the
  // first time, not a page to go back to.
  //
  // Everyone else gets the one-off note that reminders exist, once per device.
  // The tour already covers them, so whoever sees the tour has the note marked
  // as read and never meets both.
  const [tourOpen, setTourOpen] = useState(false);
  const [newsOpen, setNewsOpen] = useState(false);
  const tourKey = user ? `khata-tour-done:${user.id}` : null;
  const newsKey = user ? `khata-news-reminders:${user.id}` : null;
  const markNewsSeen = useCallback(() => {
    setNewsOpen(false);
    try {
      if (newsKey) localStorage.setItem(newsKey, "1");
    } catch {}
  }, [newsKey]);
  useEffect(() => {
    if (!user || !tourKey || !newsKey) return;
    const created = user.createdAt ? Date.parse(user.createdAt) : NaN;
    const isNew = Number.isFinite(created) && Date.now() - created <= 14 * 24 * 60 * 60 * 1000;
    try {
      if (isNew && !localStorage.getItem(tourKey)) {
        setTourOpen(true);
        localStorage.setItem(newsKey, "1");
        return;
      }
      if (!localStorage.getItem(newsKey)) setNewsOpen(true);
    } catch {}
  }, [user, tourKey, newsKey]);
  const closeTour = useCallback(() => {
    setTourOpen(false);
    try {
      if (tourKey) localStorage.setItem(tourKey, "1");
    } catch {}
  }, [tourKey]);
  const home = pathname === "/";
  const displayName = user?.name || user?.username;

  // The assistant is a full-screen chat with its own top bar and composer, so
  // it has none of the chrome around it. That used to be a separate tree
  // returned early - which made React throw the whole app away and build
  // another one on the way in, and again on the way out. That was the blink.
  // Same tree now: the chrome is simply not rendered, and what stays, stays.
  const chat = pathname === "/assistant";

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div
        className={chat ? "contents" : "w-full max-w-xl mx-auto px-4 pt-5 sm:pt-8 flex flex-col gap-5"}
        style={
          chat
            ? undefined
            : {
                paddingLeft: "max(1rem, env(safe-area-inset-left))",
                paddingRight: "max(1rem, env(safe-area-inset-right))",
                paddingTop: "max(1.25rem, env(safe-area-inset-top))",
                // room for the floating tab bar
                paddingBottom: "calc(118px + env(safe-area-inset-bottom))",
              }
        }
      >
        {!chat && (
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
                  {TITLES[section] ?? "Khata"}
                </h1>
                {SUBTITLES[section] && (
                  <p className="text-[13px] truncate" style={{ color: "var(--muted)" }}>
                    {SUBTITLES[section]}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {user && <NotificationBell onManage={() => setProfileOpen("notifications")} />}
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
                          setProfileOpen("settings");
                        }}
                        className="w-full min-h-12 flex items-center px-3 py-1.5 rounded-xl text-[14px] cursor-pointer hover:bg-[var(--surface-2)]"
                      >
                        Settings
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
        )}

        {!chat && <PullToRefresh />}

        {/* display:contents, so wrapping the page changes no layout. Each
            route is a different component, so its elements are new on every
            navigation and the arrival plays by itself - no key needed, and no
            forced remount of a page that is only re-rendering. The assistant
            brings its own full-screen layout, and grows out of the button that
            opened it. */}
        <main id="main-content" className={chat ? "chat-enter" : "contents page-enter"}>
          {children}
        </main>
      </div>

      {!chat && (
      <nav
        className={`tabbar${user?.aiAccess ? "" : " no-fab"}${user?.tripsEnabled ? " with-trips" : ""}`}
        aria-label="Primary navigation"
      >
        {TABS.map((tab) =>
          tab !== null && "optional" in tab && !user?.tripsEnabled ? null : tab === null ? (
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
      )}

      {tourOpen && user && <WelcomeTour withAssistant={Boolean(user.aiAccess)} onClose={closeTour} />}

      {newsOpen && user && !tourOpen && (
        <NotificationsNews
          onClose={markNewsSeen}
          onSetUp={() => {
            markNewsSeen();
            setProfileOpen("notifications");
          }}
        />
      )}

      {profileOpen && (
        <SettingsModal
          initialName={user?.name ?? ""}
          startOnNotifications={profileOpen === "notifications"}
          withAssistant={Boolean(user?.aiAccess)}
          onClose={closeProfile}
          onSaved={() => refreshMe()}
        />
      )}
    </>
  );
}
