"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon, RecurringIcon } from "@/components/CategoryIcon";
import { HandshakeIcon, ReceiptIcon } from "@/components/icons";
import { fetchKey, useCached } from "@/lib/swr";
import { fmtAgo } from "@/lib/format";
import { notificationKind, type NotificationKind } from "@/lib/reminder-messages";
import { ensureRegistered, setAppBadge } from "@/lib/push-client";

// The bell beside the profile picture: every notification this account has
// been sent, newest first, including the ones swiped away on the lock screen.
// Tapping one goes where the notification itself would have gone.
//
// The list is a popover that grows out of the bell itself - it is anchored to
// the right edge of the header, and scales from the point where the bell is,
// so it reads as the bell opening rather than a panel arriving from elsewhere.

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

  // The number on the app icon follows the bell: it counts what is unseen,
  // and clears the moment the bell is opened. The service worker sets it too
  // when a notification arrives with the app closed.
  useEffect(() => {
    if (data) setAppBadge(unread);
  }, [data, unread]);

  // Keep this device registered: iOS can drop a registration without telling
  // anyone. Checked on opening and on coming back to the app.
  useEffect(() => {
    ensureRegistered().catch(() => {});
    const onVisible = () => {
      if (document.visibilityState === "visible") ensureRegistered().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

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

  // Closing plays the entrance backwards, then removes the panel.
  const [closing, setClosing] = useState(false);
  const bellRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ right: number; origin: number } | null>(null);

  const finishClose = useCallback(() => {
    setOpen(false);
    setClosing(false);
    setFresh(new Set());
  }, []);

  const close = useCallback(() => {
    if (!open || closing) return;
    setClosing(true);
    // In case the animation never runs (a hidden tab, reduced motion).
    window.setTimeout(finishClose, 220);
  }, [open, closing, finishClose]);

  // Where the panel sits and where it grows from. It is aligned with the
  // header's right edge, which is further right than the bell - the profile
  // picture is in between - and its transform origin is the bell's centre.
  const openPanel = () => {
    const bell = bellRef.current;
    const header = bell?.closest("header");
    if (bell && header) {
      const b = bell.getBoundingClientRect();
      const edge = header.getBoundingClientRect().right;
      setAnchor({ right: edge - b.right, origin: edge - (b.left + b.width / 2) });
    }
    setClosing(false);
    setOpen(true);
  };

  // Escape closes it and gives focus back to the bell; focus moves into the
  // panel as it opens so a keyboard or screen reader follows it.
  useEffect(() => {
    if (!open || closing) return;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      bellRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closing, close]);

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
    <div className="relative">
      <button
        ref={bellRef}
        type="button"
        className="chat-round relative"
        onClick={() => (open ? close() : openPanel())}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open && !closing}
      >
        <BellIcon size={22} />
        {unread > 0 && (
          <span className="bell-badge" aria-hidden>
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={close} aria-hidden />
          <div
            ref={panelRef}
            className="bell-pop"
            role="dialog"
            aria-label="Notifications"
            tabIndex={-1}
            data-closing={closing ? "" : undefined}
            onAnimationEnd={(e) => {
              if (closing && e.target === e.currentTarget) finishClose();
            }}
            style={
              anchor
                ? ({
                    right: -anchor.right,
                    "--bell-origin": `calc(100% - ${anchor.origin}px)`,
                    "--bell-caret": `${anchor.origin - 7}px`,
                  } as React.CSSProperties)
                : undefined
            }
          >
            <div className="bell-pop-head">
              <h2 className="text-[16px] font-extrabold">Notifications</h2>
              <button type="button" className="bell-pop-link" onClick={manage}>
                Settings
              </button>
            </div>

            <div className="bell-pop-body">
              {items === null ? (
                <div role="status" aria-label="Loading notifications">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-3 px-1.5 py-3">
                      <span className="skeleton !rounded-2xl" style={{ width: 40, height: 40 }} />
                      <span className="flex-1 flex flex-col gap-2">
                        <span className="skeleton" style={{ width: "60%", height: 13 }} />
                        <span className="skeleton" style={{ width: "85%", height: 11 }} />
                      </span>
                    </div>
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center text-center gap-1.5 px-4 py-8">
                  <span className="icon-tile !w-11 !h-11" style={{ color: "var(--muted)" }} aria-hidden>
                    <BellIcon size={22} />
                  </span>
                  <p className="text-[15px] font-bold mt-1">No notifications yet</p>
                  <p className="text-[13px]" style={{ color: "var(--muted)" }}>
                    Reminders you receive will be listed here.
                  </p>
                </div>
              ) : (
                <ul className="bell-pop-list">
                  {items.map((item) => {
                    const kind = KIND_STYLE[notificationKind(item.tag)];
                    const isNew = fresh.has(item.id);
                    return (
                      <li key={item.id}>
                        <button type="button" className="list-row items-start" onClick={() => go(item)}>
                          <span
                            className="icon-tile !w-10 !h-10 !rounded-xl"
                            style={{ background: kind.bg, color: kind.fg }}
                            aria-hidden
                          >
                            <kind.Icon size={19} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              {/* Wraps rather than truncating: the title is where the
                                  figure is, and cutting it off loses the point. */}
                              <span className="text-[14.5px] font-bold leading-snug line-clamp-2">{item.title}</span>
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
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
