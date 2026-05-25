import { NextResponse } from "next/server";
import { readTopProducers, readGridStats, readGreenIndex } from "@/lib/snapshot";

export const revalidate = 60;

export async function GET() {
  const [producers, gridStats, greenIndex] = await Promise.all([
    readTopProducers(),
    readGridStats(),
    readGreenIndex(),
  ]);

  return NextResponse.json({ producers, gridStats, greenIndex });
}
