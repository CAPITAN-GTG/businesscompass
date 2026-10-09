"use client";

import { useEffect, useState } from "react";

/** Shorter side of a phone, including iPhone Pro Max in either orientation. */
const PHONE_SHORT_SIDE = 540;

function detectPhone(): boolean {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const shortSide = Math.min(window.innerWidth, window.innerHeight);
  // Use the short side so landscape width (often 900px+) still counts as a phone.
  if (coarse) return shortSide <= PHONE_SHORT_SIDE;
  return window.innerWidth <= 768;
}

/**
 * null until mounted — avoids SSR/client layout mismatch.
 * Once a phone is detected, the shell stays on the phone UI for the session.
 * A width-only breakpoint remounts desktop on rotate and looks like a refresh.
 */
export function useIsPhone(): boolean | null {
  const [isPhone, setIsPhone] = useState<boolean | null>(null);

  useEffect(() => {
    const sync = () => {
      setIsPhone((prev) => (prev === true ? true : detectPhone()));
    };
    sync();
    const coarse = window.matchMedia("(pointer: coarse)");
    coarse.addEventListener("change", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      coarse.removeEventListener("change", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
    };
  }, []);

  return isPhone;
}
