"use client";

import { useEffect } from "react";

// Starts Velvet's motion while Velvet is the theme, and stops it the moment it
// is not - or the moment Reduce Motion is switched on. Renders nothing.
//
// The motion is fetched the first time it is wanted, so the other themes never
// download it, and it is the theme attribute that is watched rather than some
// state of ours: the picker, the Settings switch and the script that runs
// before the first paint all set the same attribute, and whichever did, this
// follows.
export function VelvetMotion() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stop: (() => void) | null = null;
    let loading = false;
    let alive = true;

    const wanted = () => root.dataset.theme === "velvet" && !reduce.matches;
    const sync = () => {
      if (!wanted()) {
        stop?.();
        stop = null;
        return;
      }
      if (stop || loading) return;
      loading = true;
      import("@/lib/velvet-motion")
        .then((m) => {
          // The theme may have changed while it loaded.
          if (alive && !stop && wanted()) stop = m.startVelvetMotion();
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
      stop?.();
    };
  }, []);

  return null;
}
