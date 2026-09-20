"use client";

import { useEffect, useLayoutEffect } from "react";

// For the work a page has to do on arrival that decides what it looks like:
// reading a conversation, or which period was last chosen.
//
// A plain effect runs after the browser has already drawn, so the page appears
// in its empty or default state for a frame and then corrects itself - which
// is seen as a blink. This runs after React has committed but before the
// paint, so the first frame is already right.
//
// It cannot be done in useState instead: localStorage does not exist while the
// server renders. On the server there is no paint either, and React warns
// about useLayoutEffect there, so that is where this falls back.
export const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;
