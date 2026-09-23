"use client";

import { useEffect, useState } from "react";

const PHONE_MQ = "(max-width: 768px)";

/** null until mounted — avoids SSR/client layout mismatch. */
export function useIsPhone(): boolean | null {
  const [isPhone, setIsPhone] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(PHONE_MQ);
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return isPhone;
}
