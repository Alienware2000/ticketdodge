import { NextResponse } from "next/server";
import { getParkingContext } from "@/lib/parking-context";

// Live providers must be queried at request time; static builds should never
// depend on a weather, traffic, or event endpoint being reachable.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const context = await getParkingContext();
  return NextResponse.json(context, {
    headers: {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
      "X-Parking-Context-Schema": context.schemaVersion,
      "X-Parking-Context-Quality": context.quality.status,
    },
  });
}
