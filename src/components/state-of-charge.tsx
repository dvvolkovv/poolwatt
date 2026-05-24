// Compact battery-gauge visual for a producer row.
//
// Renders as: [▓▓▓▓░░░░] 78%

export function StateOfCharge({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const segments = 8;
  const filled = Math.round((clamped / 100) * segments);
  const tone =
    clamped >= 80 ? "text-up"
    : clamped >= 50 ? "text-accent"
    : clamped >= 25 ? "text-info"
    : "text-down";

  return (
    <div className={`inline-flex items-center gap-2 num text-[12px] ${tone}`}>
      <div
        className="inline-flex items-center gap-[2px]"
        role="img"
        aria-label={`State of charge ${clamped}%`}
      >
        {Array.from({ length: segments }).map((_, i) => (
          <span
            key={i}
            className={`h-3 w-[6px] rounded-[1px] ${i < filled ? "bg-current" : "bg-card-alt"}`}
          />
        ))}
      </div>
      <span className="tabular-nums">{clamped}%</span>
    </div>
  );
}
