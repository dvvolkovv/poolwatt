import Link from "next/link";
import { redirect } from "next/navigation";
import { setRequestLocale, getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth";
import { readShellContext } from "@/lib/mobile/shell-context";
import { moreSections, SECTION_HREF } from "@/lib/mobile/tabs";
import { unreadTotal } from "@/lib/work/chat-service";
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
  // §48 — сколько слов меня ждёт. Считается только для сотрудника и только
  // здесь: хаб открывают редко, а каждый экран — часто.
  const unread = ctx.isStaff ? await unreadTotal(session.user.id, session.user.role) : 0;

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
              <span className="flex items-center gap-2">
                {section === "chat" && unread > 0 && (
                  <span
                    className="num rounded-full bg-accent px-2 py-0.5 text-[11px] text-background"
                    data-testid="chat-unread"
                  >
                    {unread}
                  </span>
                )}
                <span aria-hidden className="text-muted">
                  ›
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
