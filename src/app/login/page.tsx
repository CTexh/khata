"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Something went wrong");
      return;
    }
    router.push("/expenses");
    router.refresh();
  };

  return (
    <div className="w-full max-w-sm mx-auto min-h-dvh flex flex-col items-center justify-center px-4 py-6 gap-6">
      <div className="flex items-center gap-3">
        <Logo size={52} />
        <h1 className="wordmark text-[32px]">Khata</h1>
      </div>

      <form onSubmit={submit} className="card p-6 w-full flex flex-col gap-3 rise">
        <p className="font-semibold text-lg">Welcome back</p>
        <p className="text-[13px] -mt-2" style={{ color: "var(--muted)" }}>
          Log in to see your ledger and expenses.
        </p>
        <input
          className="field"
          aria-label="Username"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          className="field"
          aria-label="Password"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p className="text-[13px]" style={{ color: "var(--bad)" }} role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary mt-1" disabled={busy}>
          {busy ? "Logging in…" : "🔓 Log in"}
        </button>
        <p className="text-[13px] text-center mt-1" style={{ color: "var(--muted)" }}>
          New here?{" "}
          <Link href="/signup" className="inline-flex min-h-12 items-center px-2 -mx-2 font-semibold" style={{ color: "var(--accent)" }}>
            Create an account
          </Link>
        </p>
      </form>
    </div>
  );
}
