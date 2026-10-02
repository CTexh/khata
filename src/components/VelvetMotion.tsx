"use client";

import { useEffect, useRef } from "react";
import { useBeforePaint } from "@/lib/before-paint";
import { landingAt } from "@/lib/velvet-stage";
import type { VelvetMotion as Motion } from "@/lib/velvet-motion";



// Starts Velvet's motion while Velvet is the theme, and stops it the moment it
// is not - or the moment Reduce Motion is switched on. Renders nothing.
//
// The motion is fetched the first time it is wanted, so the other themes never
// download it, and it is the theme attribute that is watched rather than some
// state of ours: the picker, the Settings switch and the script that runs
// before the first paint all set the same attribute, and whichever did, this
// follows.
export function VelvetMotion({ pathname }: { pathname: string }) {
  const motion = useRef<Motion | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let loading = false;
    let alive = true;

    const wanted = () => root.dataset.theme === "velvet" && !reduce.matches;
    const sync = () => {
      if (!wanted()) {
        motion.current?.stop();
        motion.current = null;
        return;
      }
      if (motion.current || loading) return;
      loading = true;
      import("@/lib/velvet-motion")
        .then((m) => {
          // The theme may have changed while it loaded.
          if (alive && !motion.current && wanted()) motion.current = m.startVelvetMotion();
        })
        .catch(() => {
          // Offline before it was ever fetched: Velvet simply stays still.
        })
        .finally(() => {
          loading = false;
        });
    };

    const watch = new MutationObserver(sync);
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    reduce.addEventListener("change", sync);
    sync();
    return () => {
      alive = false;
      watch.disconnect();
      reduce.removeEventListener("change", sync);
      motion.current?.stop();
      motion.current = null;
    };
  }, []);

  // Each page that arrives has its figures counted up as they land.
  useEffect(() => {
    motion.current?.arrive();
  }, [pathname]);

  // And its cards told when to land, before the first frame is drawn - so the
  // choreography starts right, rather than correcting itself a frame in.
  // velvet.css reads --v-at; every other theme ignores it.
  useBeforePaint(() => {
    const root = document.documentElement;
    if (root.dataset.theme !== "velvet" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cards = [...document.querySelectorAll<HTMLElement>(".rise, .day-group")];
    // Every position read first, then every value written, so the page is
    // measured once rather than once per card.
    const boxes = cards.map((el) => el.getBoundingClientRect());
    let summary: string | null = null;
    cards.forEach((el, i) => {
      const at = `${landingAt(boxes[i].top, boxes[i].left, window.innerHeight, window.innerWidth)}s`;
      el.style.setProperty("--v-at", at);
      if (!summary && el.classList.contains("hero-panel")) summary = at;
    });
    // The summary's shadow lands with it.
    const floor = document.querySelector<HTMLElement>(".velvet-floor");
    if (floor && summary) floor.style.setProperty("--v-at", summary);
  }, [pathname]);

  return null;
}
