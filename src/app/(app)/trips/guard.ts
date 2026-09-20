"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Trips is a section someone switches on in Settings. With it off the tab is
// gone, so anyone here followed an old link or a bookmark: send them home
// rather than showing a section they have turned off.
//
// The answer is asked for fresh rather than taken from the cache. The cached
// copy can be a few seconds out of date - which is fine for a heading, and not
// fine for a redirect that would throw someone off the page they just
// switched on.
export function useTripsSection(): "on" | "off" | "loading" | "failed" {
  const router = useRouter();
  const [section, setSection] = useState<"on" | "off" | "loading" | "failed">("loading");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        // Not signed in: the app's own guard sends them to the login page.
        if (!data) {
          setSection("failed");
          return;
        }
        if (!data.user) return;
        if (data.user.tripsEnabled) {
          setSection("on");
        } else {
          setSection("off");
          router.replace("/");
        }
      })
      // Asking failed - offline, most likely. Say so rather than sitting on a
      // spinner that never stops.
      .catch(() => {
        if (!cancelled) setSection("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  return section;
}
