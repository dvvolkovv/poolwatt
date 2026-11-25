import Link from "next/link";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readShellContext } from "@/lib/mobile/shell-context";
import { moreSections, SECTION_HREF } from "@/lib/mobile/tabs";
import { Screen } from "@/components/mobile/screen";

export const dynamic = "force-dynamic";

export default async function MorePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user) redirect(`/${locale}/login?callbackUrl=/${locale}/app/more`);

  const t = await getTranslations("app.tabs");
  const tSections = await getTranslations("app.sections");
  const ctx = await readShellContext(session.user.id);
  const sections = moreSections(ctx);

  return (
    <Screen title={t("more")}>
      <ul className="mt-4 rounded-lg border border-hairline bg-card divide-y divide-hairline">
        {sections.map((section) => (
          <li key={section}>
            <Link
              href={`/${locale}/app${SECTION_HREF[section]}`}
              data-section={section}
              className="flex items-center justify-between px-4 py-4 text-[15px]"
            >
              {tSections(section)}
              <span aria-hidden className="text-muted">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
