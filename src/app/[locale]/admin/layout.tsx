import { redirect, notFound } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { auth } from "@/lib/auth";

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/admin/build-requests`);
  if (session.user.role !== "ADMIN") notFound();

  const tNav = await getTranslations("admin");

  return (
    <main className="bg-bg min-h-[calc(100vh-4rem)]">
      <div className="max-w-[1600px] mx-auto px-4 md:px-12 xl:px-20 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-8">
          <aside className="md:sticky md:top-20 md:self-start">
            <div className="mb-6 hidden md:block">
              <div className="text-[11px] uppercase tracking-[0.18em] text-muted">ADMIN</div>
              <div className="text-[18px] font-semibold">{session.user.username}</div>
            </div>
            <nav className="flex md:flex-col">
              <Link
                href={`/${locale}/admin/build-requests`}
                prefetch={false}
                className="text-[14px] text-muted hover:text-foreground py-2 md:py-2.5"
              >
                🔧 {tNav("buildRequest.title")}
              </Link>
              <Link
                href={`/${locale}/admin/contractors`}
                prefetch={false}
                className="text-[14px] text-muted hover:text-foreground py-2 md:py-2.5"
              >
                🏢 {tNav("contractor.title")}
              </Link>
            </nav>
          </aside>
          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </main>
  );
}
