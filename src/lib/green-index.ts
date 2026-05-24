// Poolwatt's "Green Index" — analog of the Fear & Greed Index in the reference
// project. It expresses how much of *today's* delivered energy on the network
// came from renewable sources, plus a qualitative label.

export type GreenIndex = {
  value: number;            // 0..100
  classification:
    | "carbon-heavy"
    | "mixed"
    | "neutral"
    | "renewable"
    | "fully-renewable";
};

export const MOCK_GREEN_INDEX: GreenIndex = {
  value: 84,
  classification: "renewable",
};

export function greenIndexColor(c: GreenIndex["classification"]): string {
  switch (c) {
    case "fully-renewable":
    case "renewable":
      return "text-up";
    case "carbon-heavy":
      return "text-down";
    case "mixed":
    case "neutral":
    default:
      return "text-accent";
  }
}
