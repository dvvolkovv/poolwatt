import Link from "next/link";

/**
 * Every screen below the main one looks the same: a title row with a way
 * back, then one column. The bottom padding clears the tab bar.
 */
export function Screen({
  title,
  back,
  children,
}: {
  title: string;
  back?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
      <header className="flex items-center gap-3 h-12">
        {back && (
          <Link
            href={back}
            aria-label={title}
            className="text-muted text-[20px] leading-none -ml-1 px-1"
          >
            ‹
          </Link>
        )}
        <h1 className="text-[20px] font-semibold tracking-[-0.01em]">{title}</h1>
      </header>
      {children}
    </div>
  );
}
