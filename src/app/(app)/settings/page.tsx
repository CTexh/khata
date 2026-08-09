"use client";

import { useCallback, useEffect, useState } from "react";

function Spinner() {
  return (
    <div className="flex justify-center py-16" role="status" aria-label="Loading settings">
      <div
        className="w-6 h-6 rounded-full border-2 animate-spin"
        style={{ borderColor: "var(--hairline)", borderTopColor: "var(--accent)" }}
      />
    </div>
  );
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [testMsg, setTestMsg] = useState<{ text: string; bad?: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/settings/notifications");
    if (res.ok) {
      const d = await res.json();
      setPhone(d.phone ?? "");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    const res = await fetch("/api/settings/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    setSaving(false);
    setSaveMsg(
      res.ok ? { text: "Saved." } : { text: "Couldn't save — try again.", bad: true }
    );
  };

  const sendTest = async (type: "subscription" | "monthly_report") => {
    setTesting(true);
    setTestMsg(null);
    const res = await fetch("/api/settings/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, type }),
    });
    setTesting(false);
    if (res.ok) {
      setTestMsg({ text: "Sent — check WhatsApp." });
    } else {
      const j = await res.json().catch(() => ({}));
      setTestMsg({ text: j.error ?? "Couldn't send test message.", bad: true });
    }
  };

  if (loading) return <Spinner />;

  return (
    <>
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Get a WhatsApp nudge the day before a subscription is due, and again the day of.
        </p>
      </div>

      <form onSubmit={save} className="card p-5 rise flex flex-col gap-3 mt-4">
        <p className="font-semibold">WhatsApp reminders</p>
        <p className="text-[13px]" style={{ color: "var(--muted)" }}>
          Sent via Meta&apos;s official WhatsApp Business Cloud API - a due-date nudge the day
          before and the day of, plus an end-of-month expense report.
        </p>

        <input
          className="field"
          aria-label="WhatsApp number"
          placeholder="WhatsApp number, e.g. +923001234567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        {saveMsg && (
          <p className="text-[13px]" style={{ color: saveMsg.bad ? "var(--bad)" : "var(--good)" }} role="status">
            {saveMsg.text}
          </p>
        )}

        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost !py-2 text-[12px]"
            onClick={() => sendTest("subscription")}
            disabled={testing || !phone}
          >
            {testing ? "Sending…" : "Send test reminder"}
          </button>
          <button
            type="button"
            className="btn btn-ghost !py-2 text-[12px]"
            onClick={() => sendTest("monthly_report")}
            disabled={testing || !phone}
          >
            {testing ? "Sending…" : "Send test expense report"}
          </button>
          <button className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "💾 Save"}
          </button>
        </div>

        {testMsg && (
          <p className="text-[13px]" style={{ color: testMsg.bad ? "var(--bad)" : "var(--good)" }} role="status">
            {testMsg.text}
          </p>
        )}
      </form>
    </>
  );
}
