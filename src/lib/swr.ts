"use client";

// A small stale-while-revalidate cache for the app's GET endpoints.
//
// Every page used to fetch on mount and show a spinner until the database
// answered. Now the last response for each URL is kept in memory and in this
// browser's storage: a page renders it at once, then refreshes it in the
// background and re-renders only if something changed. Opening a page you've
// seen before never waits on the network.
//
// The storage is per device and cleared on login, signup and logout, so one
// account's figures are never shown to another.
import { useCallback, useLayoutEffect, useReducer } from "react";

type Entry = { data: unknown; at: number };

const PREFIX = "khata-cache:v1:";
// Data this fresh is shown without asking the server again, so moving between
// tabs doesn't send a round of requests each time. Changes still refresh at
// once (invalidate), as does coming back to the app (visibilitychange).
const DEDUPE_MS = 30_000;

const mem = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const listeners = new Map<string, Set<() => void>>();
const failures = new Map<string, number>(); // HTTP status, or 0 for a network error

export class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function readStored(key: string): Entry | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as Entry;
    mem.set(key, entry);
    return entry;
  } catch {
    return undefined;
  }
}

// Which keys have a stored copy. Kept as one list so that clearing a section
// after a change doesn't have to walk the whole of localStorage - which it did
// on every save, and twenty times over when re-categorising twenty expenses.
// Built once per session from what is actually there, so copies written by an
// older version are still found.
let keyIndex: Set<string> | null = null;
function storedKeys(): Set<string> {
  if (keyIndex) return keyIndex;
  const found = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) found.add(k.slice(PREFIX.length));
    }
  } catch {}
  keyIndex = found;
  return keyIndex;
}

function store(key: string, entry: Entry) {
  mem.set(key, entry);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(entry));
    storedKeys().add(key);
  } catch {
    // Storage full or blocked: the in-memory copy still works.
  }
}

function notify(key: string) {
  listeners.get(key)?.forEach((l) => l());
}

export function peek<T>(key: string): T | undefined {
  return (mem.get(key) ?? readStored(key))?.data as T | undefined;
}

// True when a key's cached answer is recent enough to use without asking again.
export function isFresh(key: string): boolean {
  const entry = mem.get(key) ?? readStored(key);
  return Boolean(entry) && Date.now() - (entry as Entry).at <= DEDUPE_MS;
}

// Fetches a URL once however many components ask at the same moment, and
// shares the answer with all of them.
export function fetchKey<T>(key: string): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const request = fetch(key, { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new HttpError(res.status);
      return res.json() as Promise<T>;
    })
    .then((data) => {
      store(key, { data, at: Date.now() });
      failures.delete(key);
      notify(key);
      return data;
    })
    .catch((err) => {
      failures.set(key, err instanceof HttpError ? err.status : 0);
      notify(key);
      throw err;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

// One request that answers several keys at once (see /api/bootstrap). Each
// key it covers is registered as in flight straight away, so any page that
// asks for one meanwhile waits for this response instead of sending its own
// request. A key the response doesn't include - or a failed response - falls
// back to that key's own endpoint.
export function primeFrom(url: string, keys: string[]) {
  const loader = fetch(url, { cache: "no-store" }).then((res) => {
    if (!res.ok) throw new HttpError(res.status);
    return res.json() as Promise<{ data: Record<string, unknown> }>;
  });
  for (const key of keys) {
    if (inflight.has(key)) continue;
    const pending: Promise<unknown> = loader.then(
      ({ data }) => {
        inflight.delete(key);
        if (!data || !(key in data)) return fetchKey(key);
        store(key, { data: data[key], at: Date.now() });
        failures.delete(key);
        notify(key);
        return data[key];
      },
      () => {
        inflight.delete(key);
        return fetchKey(key);
      }
    );
    pending.catch(() => {});
    inflight.set(key, pending);
  }
}

// Refreshes everything under a URL prefix after a change - "/api/expenses"
// covers the month lists, category totals and Home's figures. Keys no page is
// showing are simply dropped and fetched next time they're needed.
export function invalidate(prefix: string) {
  for (const key of new Set([...mem.keys(), ...storedKeys()])) {
    if (!key.startsWith(prefix)) continue;
    if (listeners.get(key)?.size) {
      fetchKey(key).catch(() => {});
    } else {
      mem.delete(key);
      storedKeys().delete(key);
      try {
        localStorage.removeItem(PREFIX + key);
      } catch {}
    }
  }
}

// Everything the screen is currently showing, fetched again. This is what
// pulling down on a page does: the one way to retry by hand, for a screen
// whose last attempt failed.
export function refreshAll(): Promise<unknown> {
  const showing = [...listeners.entries()].filter(([, set]) => set.size).map(([key]) => key);
  return Promise.all(showing.map((key) => fetchKey(key).catch(() => {})));
}

export function clearCache() {
  mem.clear();
  failures.clear();
  keyIndex = null;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) stale.push(k);
    }
    stale.forEach((k) => localStorage.removeItem(k));
  } catch {}
}

// Coming back to the app (switching tabs, unlocking the phone) refreshes
// whatever is on screen.
let focusHooked = false;
function hookFocus() {
  if (focusHooked || typeof window === "undefined") return;
  focusHooked = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    // Switching away for a second and back should cost nothing: only what has
    // gone stale is asked for again.
    for (const [key, set] of listeners) if (set.size && !isFresh(key)) fetchKey(key).catch(() => {});
  });
}

export function useCached<T>(key: string | null) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // Before paint, not after: reading the stored copy in a plain effect meant
  // the browser had already drawn a spinner for data that was on the device
  // all along. Still after hydration, so the server-rendered HTML and the
  // first client render match exactly.
  useLayoutEffect(() => {
    if (!key) return;
    hookFocus();
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(rerender);
    if (!mem.has(key) && readStored(key)) rerender();
    const entry = mem.get(key);
    if (!entry || Date.now() - entry.at > DEDUPE_MS) fetchKey(key).catch(() => {});
    return () => {
      set.delete(rerender);
    };
  }, [key]);

  const refresh = useCallback(() => (key ? fetchKey<T>(key) : Promise.resolve(undefined as T)), [key]);
  const mutate = useCallback(
    (next: T) => {
      if (!key) return;
      store(key, { data: next, at: Date.now() });
      notify(key);
    },
    [key]
  );

  const entry = key ? mem.get(key) : undefined;
  return {
    data: entry?.data as T | undefined,
    // Set only when the latest attempt failed; cached data may still be shown.
    failedStatus: key ? failures.get(key) : undefined,
    refresh,
    mutate,
  };
}
