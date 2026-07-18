import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TRAFFIC_DATASET_URL =
  "https://data.cityofnewyork.us/resource/i4gi-tjb9.json";
const TRAFFIC_SOURCE_URL =
  "https://data.cityofnewyork.us/Transportation/DOT-Traffic-Speeds/i4gi-tjb9";

type TrafficRow = {
  speed?: string;
  data_as_of?: string;
  link_id?: string;
  link_name?: string;
  link_points?: string;
};

function distanceInMiles(
  lat: number,
  lng: number,
  targetLat: number,
  targetLng: number,
) {
  const latitudeMiles = (lat - targetLat) * 69;
  const longitudeMiles =
    (lng - targetLng) * 69 * Math.cos((targetLat * Math.PI) / 180);
  return Math.hypot(latitudeMiles, longitudeMiles);
}

function nearestPointDistance(
  points: string | undefined,
  lat: number,
  lng: number,
) {
  if (!points) return Number.POSITIVE_INFINITY;

  return points
    .trim()
    .split(/\s+/)
    .map((point) => point.split(",").map(Number))
    .filter(
      (point) =>
        point.length === 2 &&
        Number.isFinite(point[0]) &&
        Number.isFinite(point[1]),
    )
    .reduce(
      (nearest, [pointLat, pointLng]) =>
        Math.min(nearest, distanceInMiles(pointLat, pointLng, lat, lng)),
      Number.POSITIVE_INFINITY,
    );
}

function describeTraffic(speedMph: number) {
  if (speedMph >= 28) {
    return { label: "Moving well", searchMultiplier: 0.9 };
  }
  if (speedMph >= 18) {
    return { label: "Moderate", searchMultiplier: 1 };
  }
  if (speedMph >= 10) {
    return { label: "Slow", searchMultiplier: 1.2 };
  }
  return { label: "Heavy", searchMultiplier: 1.4 };
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get("lat") ?? 40.7411);
  const lng = Number(request.nextUrl.searchParams.get("lng") ?? -73.9897);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  try {
    const url = new URL(TRAFFIC_DATASET_URL);
    url.searchParams.set(
      "$select",
      "speed,data_as_of,link_id,link_name,link_points",
    );
    url.searchParams.set(
      "$where",
      "borough='Manhattan' AND status='0'",
    );
    url.searchParams.set("$order", "data_as_of DESC");
    url.searchParams.set("$limit", "1000");

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`NYC DOT returned ${response.status}`);

    const rows = (await response.json()) as TrafficRow[];
    const latestByLink = new Map<string, TrafficRow>();
    for (const row of rows) {
      const key = row.link_id ?? row.link_name;
      if (key && !latestByLink.has(key)) latestByLink.set(key, row);
    }

    const nearest = Array.from(latestByLink.values())
      .map((row) => ({
        row,
        distanceMiles: nearestPointDistance(row.link_points, lat, lng),
      }))
      .filter(({ row, distanceMiles }) =>
        Number.isFinite(Number(row.speed)) &&
        Number(row.speed) > 0 &&
        Number.isFinite(distanceMiles),
      )
      .sort((a, b) => a.distanceMiles - b.distanceMiles)[0];

    if (!nearest) throw new Error("No nearby NYC DOT link was available");

    const speedMph = Number(nearest.row.speed);
    const traffic = describeTraffic(speedMph);

    return NextResponse.json(
      {
        available: true,
        source: "NYC DOT Traffic Speeds",
        sourceUrl: TRAFFIC_SOURCE_URL,
        speedMph: Math.round(speedMph),
        observedAt: nearest.row.data_as_of,
        linkName: nearest.row.link_name,
        distanceMiles: Number(nearest.distanceMiles.toFixed(1)),
        ...traffic,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        available: false,
        source: "NYC DOT Traffic Speeds",
        sourceUrl: TRAFFIC_SOURCE_URL,
        label: "Feed unavailable",
        searchMultiplier: 1,
        error: error instanceof Error ? error.message : "Unknown traffic error",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
