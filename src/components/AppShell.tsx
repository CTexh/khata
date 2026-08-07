"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar } from "@/components/Avatar";

type CurrentUser = { id: string; username: string; isAdmin: boolean };

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: "" },
  { href: "/expenses", label: "Mera Khata", icon: "" },
  { href: "/udhar-khata", label: "Udhar Khata", icon: "" },
  { href: "/subscriptions", label: "Subscriptions", icon: "" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user));
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
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
    </>
  );
}
