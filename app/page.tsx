"use client";

import DesktopApp from "@/components/DesktopApp";
import MobileApp from "@/components/MobileApp";
import { useIsPhone } from "@/hooks/useIsPhone";

export default function Home() {
  const isPhone = useIsPhone();

  if (isPhone === null) {
    return <div className="app-boot" aria-busy="true" />;
  }

  return isPhone ? <MobileApp /> : <DesktopApp />;
}
