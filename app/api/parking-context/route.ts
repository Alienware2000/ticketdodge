import { NextResponse } from "next/server";
import { getParkingContext } from "@/lib/parking-context";

// Live providers must be queried at request time; static builds should never
// depend on a weather, traffic, or event endpoint being reachable.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(await getParkingContext(), {
    headers: {
      "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300",
    },
  });
}
