export type ParkingContext = {
  observedAt: string;
  weather: {
    temperatureF: number | null;
    precipitationProbability: number | null;
    precipitationInches: number | null;
    weatherCode: number | null;
  };
  traffic: {
    medianMph: number | null;
    sampledLinks: number;
  };
  events: {
    activeOrUpcoming: number;
  };
  sources: {
    weather: "open-meteo" | "unavailable";
    traffic: "nyc-dot" | "unavailable";
    events: "nyc-open-data" | "unavailable";
  };
};

const FLATIRON = { lat: 40.7411, lng: -73.9897 };
const TRAFFIC_URL = "https://linkdata.nyctmc.org/data/LinkSpeedQuery.txt";
const EVENTS_URL = "https://data.cityofnewyork.us/resource/tvpp-9vvx.json";

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isNearFlatiron(points: string) {
  const firstPoint = points.split(" ")[0];
  const [lat, lng] = firstPoint.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.hypot(lat - FLATIRON.lat, lng - FLATIRON.lng) < 0.045;
}

async function getWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(FLATIRON.lat));
  url.searchParams.set("longitude", String(FLATIRON.lng));
  url.searchParams.set("current", "temperature_2m,precipitation,weather_code");
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("forecast_days", "1");

  const response = await fetch(url, { next: { revalidate: 300 } });
  if (!response.ok) throw new Error("Weather request failed");
  const data = await response.json();
  const hour = new Date().getHours();
  return {
    temperatureF: data.current?.temperature_2m ?? null,
    precipitationInches: data.current?.precipitation ?? null,
    weatherCode: data.current?.weather_code ?? null,
    precipitationProbability: data.hourly?.precipitation_probability?.[hour] ?? null,
  };
}

async function getTraffic() {
  const response = await fetch(TRAFFIC_URL, { next: { revalidate: 120 } });
  if (!response.ok) throw new Error("Traffic request failed");
  const lines = (await response.text()).trim().split(/\r?\n/);
  const speeds = lines.slice(1).flatMap((line) => {
    const columns = line.split("\t").map((value) => value.replaceAll('"', ""));
    const speed = Number(columns[1]);
    const linkPoints = columns[6] ?? "";
    return speed > 0 && isNearFlatiron(linkPoints) ? [speed] : [];
  });
  return { medianMph: median(speeds), sampledLinks: speeds.length };
}

async function getEvents() {
  const now = Date.now();
  const url = new URL(EVENTS_URL);
  // The city publishes event timestamps as text, so this lightweight filter is
  // intentionally applied after retrieval instead of issuing an invalid SOQL
  // date comparison. The API response is still narrowed to Manhattan.
  url.searchParams.set("$select", "start_date_time,end_date_time");
  url.searchParams.set("$where", "event_borough = 'Manhattan'");
  url.searchParams.set("$order", "start_date_time ASC");
  url.searchParams.set("$limit", "5000");
  const response = await fetch(url, { next: { revalidate: 300 } });
  if (!response.ok) throw new Error("Event request failed");
  const data: { start_date_time?: string; end_date_time?: string }[] = await response.json();
  return data.filter((event) => {
    const start = Date.parse(event.start_date_time ?? "");
    const end = Date.parse(event.end_date_time ?? "");
    return Number.isFinite(start) && Number.isFinite(end) && start <= now + 3 * 60 * 60_000 && end >= now;
  }).length;
}

/** Fetches live exogenous features. Individual provider failures degrade independently. */
export async function getParkingContext(): Promise<ParkingContext> {
  const [weather, traffic, events] = await Promise.allSettled([getWeather(), getTraffic(), getEvents()]);
  return {
    observedAt: new Date().toISOString(),
    weather: weather.status === "fulfilled" ? weather.value : { temperatureF: null, precipitationInches: null, weatherCode: null, precipitationProbability: null },
    traffic: traffic.status === "fulfilled" ? traffic.value : { medianMph: null, sampledLinks: 0 },
    events: { activeOrUpcoming: events.status === "fulfilled" ? events.value : 0 },
    sources: {
      weather: weather.status === "fulfilled" ? "open-meteo" : "unavailable",
      traffic: traffic.status === "fulfilled" ? "nyc-dot" : "unavailable",
      events: events.status === "fulfilled" ? "nyc-open-data" : "unavailable",
    },
  };
}
