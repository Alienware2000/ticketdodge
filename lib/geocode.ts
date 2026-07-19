export type GeocodeResult = {
  id: string;
  label: string;
  lat: number;
  lng: number;
};

// Bound suggestions to the Flatiron / Midtown-south area so "20" resolves to
// a nearby street, not a namesake across the country.
const VIEWBOX = "-74.010,40.755,-73.970,40.725"; // left,top,right,bottom
const ENDPOINT = "https://nominatim.openstreetmap.org/search";

/**
 * Free geocoding autocomplete via Nominatim. Debounce calls in the caller and
 * pass an AbortSignal so superseded keystrokes cancel. Returns [] on any error.
 */
export async function geocode(
  query: string,
  signal?: AbortSignal,
): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];

  const url = new URL(ENDPOINT);
  url.searchParams.set("q", `${trimmed}, Manhattan, New York`);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("limit", "5");
  url.searchParams.set("viewbox", VIEWBOX);
  url.searchParams.set("bounded", "1");

  try {
    const response = await fetch(url, {
      signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const rows: Array<{
      place_id: number | string;
      display_name: string;
      name?: string;
      lat: string;
      lon: string;
    }> = await response.json();

    return rows.map((row) => ({
      id: String(row.place_id),
      label: row.name || row.display_name.split(",").slice(0, 2).join(", "),
      lat: Number(row.lat),
      lng: Number(row.lon),
    }));
  } catch {
    return [];
  }
}
