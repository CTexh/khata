"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Avatar } from "@/components/Avatar";

type CurrentUser = { id: string; username: string; isAdmin: boolean };

const NAV_ITEMS = [
  { href: "/", label: "Khata", icon: "" },
  { href: "/expenses", label: "Mera Khata", icon: "" },
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
    <div className="w-full max-w-xl mx-auto px-4 py-6 sm:py-10 flex flex-col gap-5">
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
              >
                <Avatar id={user.id} name={user.username} size={32} />
              </button>
              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="card absolute right-0 top-12 z-20 p-2 w-48 rise">
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
                      className="w-full text-left px-3 py-1.5 rounded-lg text-[13px] cursor-pointer"
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

      <nav className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {items.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`btn shrink-0 !py-2 ${active ? "btn-primary" : "btn-ghost"}`}
            >
              {item.icon && <span>{item.icon}</span>}
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
