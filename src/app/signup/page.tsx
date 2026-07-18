"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords don't match");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/signup", {
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
    router.push("/");
    router.refresh();
  };

  return (
    <div className="w-full max-w-sm mx-auto min-h-dvh flex flex-col items-center justify-center px-4 gap-6">
      <div className="flex items-center gap-3">
        <Logo size={52} />
        <h1 className="wordmark text-[32px]">Khata</h1>
      </div>

      <form onSubmit={submit} className="card p-6 w-full flex flex-col gap-3 rise">
        <p className="font-semibold text-lg">Create your account</p>
        <p className="text-[13px] -mt-2" style={{ color: "var(--muted)" }}>
          Track loans and expenses, synced everywhere.
        </p>
        <input
          className="field"
          placeholder="Choose a username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          required
        />
        <input
          className="field"
          placeholder="Password (min 6 characters)"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <input
          className="field"
          placeholder="Confirm password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && (
          <p className="text-[13px]" style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}
        <button className="btn btn-primary mt-1" disabled={busy}>
          {busy ? "Creating…" : "✨ Create account"}
        </button>
        <p className="text-[13px] text-center mt-1" style={{ color: "var(--muted)" }}>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold" style={{ color: "var(--accent)" }}>
            Log in
          </Link>
        </p>
      </form>
    </div>
  );
}
