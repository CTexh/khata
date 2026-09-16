"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/Sheet";
import { BellIcon, RecurringIcon } from "@/components/CategoryIcon";
import { HandshakeIcon, ReceiptIcon } from "@/components/icons";
import { fetchKey, useCached } from "@/lib/swr";
import { fmtAgo } from "@/lib/format";
import { notificationKind, type NotificationKind } from "@/lib/reminder-messages";

// The bell beside the profile picture: every notification this account has
// been sent, newest first, including the ones swiped away on the lock screen.
// Tapping one goes where the notification itself would have gone.

type Item = {
  id: string;
  title: string;
  body: string;
  url: string | null;
  tag: string | null;
  created_at: string;
  read: boolean;
};
type Feed = { items: Item[]; unread: number };

const KEY = "/api/notifications";

const KIND_STYLE: Record<NotificationKind, { Icon: (p: { size?: number }) => React.ReactElement; bg: string; fg: string }> = {
  subscription: { Icon: RecurringIcon, bg: "var(--good-soft)", fg: "var(--good)" },
  udhar: { Icon: HandshakeIcon, bg: "var(--accent-soft)", fg: "var(--accent)" },
  expenses: { Icon: ReceiptIcon, bg: "var(--cat-food-dining-bg)", fg: "var(--cat-food-dining-fg)" },
  general: { Icon: BellIcon, bg: "var(--surface-2)", fg: "var(--muted)" },
};

export function NotificationBell({ onManage }: { onManage: () => void }) {
  const { data, mutate } = useCached<Feed>(KEY);
  const [open, setOpen] = useState(false);
  // What was new when it was first shown in this opening, so it keeps its dot
  // while the list is up even though it has already been marked as seen.
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const router = useRouter();
  const unread = data?.unread ?? 0;

  // A notification that lands while the app is open shows up straight away:
  // the service worker says so as it displays it.
  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "khata:notification") fetchKey(KEY).catch(() => {});
    };
    sw.addEventListener("message", onMessage);
    return () => sw.removeEventListener("message", onMessage);
  }, []);

  // Anything unseen, once the list is actually open, is marked as seen - here
  // at once so the badge clears, and on the server up to the newest one shown,
  // so something that arrives in between is not marked without being listed.
  useEffect(() => {
    if (!open || !data) return;
    const unseen = data.items.filter((i) => !i.read);
    if (!unseen.length && !data.unread) return;
    setFresh((prev) => new Set([...prev, ...unseen.map((i) => i.id)]));
    mutate({ items: data.items.map((i) => ({ ...i, read: true })), unread: 0 });
    const newest = data.items[0]?.created_at;
    fetch(KEY, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ before: newest ?? null }),
    }).catch(() => {});
  }, [open, data, mutate]);

  const close = () => {
    setOpen(false);
    setFresh(new Set());
  };

  const go = (item: Item) => {
    close();
    if (item.url) router.push(item.url);
  };

  const manage = () => {
    close();
    onManage();
  };

  const items = data?.items ?? null;

  return (
    <>
      <button
        type="button"
        className="chat-round relative"
        onClick={() => setOpen(true)}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-haspopup="dialog"
      >
        <BellIcon size={22} />
        {unread > 0 && (
          <span className="bell-badge" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <Sheet title="Notifications" onClose={close}>
          {items === null ? (
            <div className="list-card" role="status" aria-label="Loading notifications">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-1.5 py-3">
                  <span className="skeleton !rounded-2xl" style={{ width: 44, height: 44 }} />
                  <span className="flex-1 flex flex-col gap-2">
                    <span className="skeleton" style={{ width: "60%", height: 13 }} />
                    <span className="skeleton" style={{ width: "85%", height: 11 }} />
                  </span>
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="card p-6 flex flex-col items-center text-center gap-2">
              <span className="icon-tile" style={{ color: "var(--muted)" }} aria-hidden>
                <BellIcon size={24} />
              </span>
              <p className="text-[16px] font-bold mt-1">No notifications yet</p>
              <p className="text-[14px]" style={{ color: "var(--muted)" }}>
                Reminders you receive will be listed here.
              </p>
              <button type="button" className="btn btn-ghost mt-2" onClick={manage}>
                Manage notifications
              </button>
            </div>
          ) : (
            <>
              <ul className="list-card">
                {items.map((item) => {
                  const kind = KIND_STYLE[notificationKind(item.tag)];
                  const isNew = fresh.has(item.id);
                  return (
                    <li key={item.id}>
                      <button type="button" className="list-row items-start" onClick={() => go(item)}>
                        <span
                          className="icon-tile !w-11 !h-11 !rounded-2xl"
                          style={{ background: kind.bg, color: kind.fg }}
                          aria-hidden
                        >
                          <kind.Icon size={20} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            {/* Wraps rather than truncating: the title is where the
                                figure is, and cutting it off loses the point. */}
                            <span className="text-[15px] font-bold leading-snug line-clamp-2">{item.title}</span>
                            <span className="text-[12px] shrink-0 tabular pt-0.5" style={{ color: "var(--muted)" }}>
                              {fmtAgo(item.created_at)}
                            </span>
                          </span>
                          <span className="block text-[13px] mt-0.5 line-clamp-2" style={{ color: "var(--muted)" }}>
                            {item.body}
                          </span>
                        </span>
                        {isNew && <span className="bell-dot" aria-label="New" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="btn btn-ghost self-center" onClick={manage}>
                Notification settings
              </button>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}
