// Inline SVG sparkline. The reference project uses the same shape — we keep
// it API-compatible so it can be dropped into the producer row table.

type Props = {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  tone?: "up" | "down" | "muted";
};

export function Sparkline({ data, width = 120, height = 28, className, tone }: Props) {
  if (!data || data.length < 2) return <div style={{ width, height }} aria-hidden />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const step = width / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const stroke =
    tone === "up" ? "var(--color-up)"
    : tone === "down" ? "var(--color-down)"
    : data[data.length - 1] >= data[0] ? "var(--color-up)" : "var(--color-down)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
