import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function CabinetLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${locale}/login?callbackUrl=/${locale}/me/favorites`);
  }

  const t = await getTranslations("cabinet.sidebar");

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
          <aside className="md:sticky md:top-20 md:self-start">
            <div className="mb-6 hidden md:block">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">@</div>
              <div className="text-[18px] font-semibold tracking-[-0.01em]">
                {session.user.username}
              </div>
            </div>
            <nav className="flex md:flex-col gap-1 md:gap-0 overflow-x-auto md:overflow-visible">
              <SidebarLink href={`/${locale}/me/favorites`}>
                ★ {t("favorites")}
              </SidebarLink>
              <SidebarLink href={`/${locale}/me/settings`}>
                ⚙ {t("settings")}
              </SidebarLink>
            </nav>
          </aside>
          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </main>
  );
}

function SidebarLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="text-[14px] text-muted hover:text-foreground transition-colors py-2 md:py-2.5 px-3 md:px-0 rounded-md whitespace-nowrap"
    >
      {children}
    </Link>
  );
}
