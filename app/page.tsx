"use client";

import DesktopApp from "@/components/DesktopApp";
import MobileApp from "@/components/MobileApp";
import { useBusinessCompass } from "@/hooks/useBusinessCompass";
import { useIsPhone } from "@/hooks/useIsPhone";

export default function Home() {
  const isPhone = useIsPhone();
  // Lives above the phone/desktop shells so a layout swap cannot wipe the session.
  const compass = useBusinessCompass();

  if (isPhone === null) {
    return <div className="app-boot" aria-busy="true" />;
  }

  return isPhone ? <MobileApp c={compass} /> : <DesktopApp c={compass} />;
}
