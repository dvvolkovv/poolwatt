// §22 — the phone shell. Lives inside the locale layout, so translations and
// the intl provider come for free; the site navbar and footer are swallowed by
// ChromeGate.

import type { Metadata, Viewport } from "next";
import { setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readUserStatus } from "@/lib/exchange/user-status";
import { visibleTabs } from "@/lib/mobile/tabs";
import { TabBar } from "@/components/mobile/tab-bar";
import { SwRegister } from "@/components/mobile/sw-register";

export const metadata: Metadata = {
  title: "Poolwatt",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Poolwatt",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0c1014",
};

export default async function MobileLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  const status = session?.user ? await readUserStatus(session.user.id) : "GUEST";

  return (
    <div className="min-h-screen bg-bg">
      <SwRegister locale={locale} />
      {children}
      <TabBar tabs={visibleTabs(status)} locale={locale} />
    </div>
  );
}
