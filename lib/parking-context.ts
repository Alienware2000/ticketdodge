type ProviderName = "open-meteo" | "nyc-dot" | "nyc-open-data" | "here-parking";
type ProviderStatus = "live" | "no-data" | "unavailable";

export type ProviderMeta = {
  provider: ProviderName;
  status: ProviderStatus;
  /** Time this service successfully received and validated the response. */
  fetchedAt: string;
  /** The provider's own timestamp when one is available. */
  dataAsOf: string | null;
  /** Expected upstream refresh interval, used by clients to assess freshness. */
  refreshSeconds: number;
  responseMs: number | null;
  records: number | null;
  /** Stable, non-sensitive failure category. Never exposes an upstream error body. */
  errorCode?: "timeout" | "network" | "http_error" | "invalid_payload";
};

export type ParkingContext = {
  schemaVersion: "1.1";
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
  parking: {
    nearbyFacilities: number;
    reportedFreeSpaces: number | null;
  };
  // Kept as a compact, backwards-compatible provider summary for the UI.
  sources: {
    weather: "open-meteo" | "unavailable";
    traffic: "nyc-dot" | "unavailable";
    events: "nyc-open-data" | "unavailable";
    parking: "here" | "unavailable";
  };
  provenance: {
    weather: ProviderMeta;
    traffic: ProviderMeta;
    events: ProviderMeta;
    parking: ProviderMeta;
  };
  quality: {
    status: "live" | "degraded" | "unavailable";
    liveProviders: number;
    totalProviders: 4;
  };
};

const FLATIRON = { lat: 40.7411, lng: -73.9897 };
const TRAFFIC_URL = "https://linkdata.nyctmc.org/data/LinkSpeedQuery.txt";
const EVENTS_URL = "https://data.cityofnewyork.us/resource/tvpp-9vvx.json";
const REQUEST_TIMEOUT_MS = 6_000;

class ProviderError extends Error {
  constructor(readonly code: NonNullable<ProviderMeta["errorCode"]>) {
    super(code);
  }
}

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

async function providerFetch(url: URL | string, revalidate: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { next: { revalidate }, signal: controller.signal });
    if (!response.ok) throw new ProviderError("http_error");
    return response;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ProviderError("timeout");
    throw new ProviderError("network");
  } finally {
    clearTimeout(timer);
  }
}

async function getWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(FLATIRON.lat));
  url.searchParams.set("longitude", String(FLATIRON.lng));
  url.searchParams.set("current", "temperature_2m,precipitation,weather_code");
  url.searchParams.set("hourly", "precipitation_probability");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("forecast_days", "1");

  const response = await providerFetch(url, 300);
  let data: { current?: { time?: string; temperature_2m?: unknown; precipitation?: unknown; weather_code?: unknown }; hourly?: { time?: unknown; precipitation_probability?: unknown } };
  try {
    data = await response.json();
  } catch {
    throw new ProviderError("invalid_payload");
  }
  if (!data.current || !Array.isArray(data.hourly?.time) || !Array.isArray(data.hourly?.precipitation_probability)) {
    throw new ProviderError("invalid_payload");
  }
  const hourIndex = data.hourly.time.indexOf(data.current.time ?? "");
  const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    value: {
      temperatureF: numeric(data.current.temperature_2m),
      precipitationInches: numeric(data.current.precipitation),
      weatherCode: numeric(data.current.weather_code),
      precipitationProbability: numeric(data.hourly.precipitation_probability[hourIndex]),
    },
    dataAsOf: data.current.time ?? null,
    records: 1,
  };
}

async function getTraffic() {
  const response = await providerFetch(TRAFFIC_URL, 120);
  const body = await response.text();
  const lines = body.trim().split(/\r?\n/);
  if (lines.length < 2) throw new ProviderError("invalid_payload");
  const speeds = lines.slice(1).flatMap((line) => {
    const columns = line.split("\t").map((value) => value.replaceAll('"', ""));
    const speed = Number(columns[1]);
    const linkPoints = columns[6] ?? "";
    return speed > 0 && isNearFlatiron(linkPoints) ? [speed] : [];
  });
  return { value: { medianMph: median(speeds), sampledLinks: speeds.length }, dataAsOf: null, records: speeds.length };
}

async function getEvents() {
  const now = Date.now();
  const url = new URL(EVENTS_URL);
  // Timestamp fields are inconsistently typed in this feed, so filtering is
  // deliberately done after retrieval rather than relying on fragile SOQL casts.
  url.searchParams.set("$select", "start_date_time,end_date_time");
  url.searchParams.set("$where", "event_borough = 'Manhattan'");
  url.searchParams.set("$order", "start_date_time ASC");
  url.searchParams.set("$limit", "5000");
  const response = await providerFetch(url, 300);
  let data: { start_date_time?: string; end_date_time?: string }[];
  try {
    data = await response.json();
  } catch {
    throw new ProviderError("invalid_payload");
  }
  if (!Array.isArray(data)) throw new ProviderError("invalid_payload");
  const active = data.filter((event) => {
    const start = Date.parse(event.start_date_time ?? "");
    const end = Date.parse(event.end_date_time ?? "");
    return Number.isFinite(start) && Number.isFinite(end) && start <= now + 3 * 60 * 60_000 && end >= now;
  }).length;
  return { value: active, dataAsOf: null, records: data.length };
}

async function getHereParking() {
  const token = process.env.HERE_ACCESS_TOKEN;
  if (!token) throw new ProviderError("network");
  const url = new URL("https://parking-v2.cc.api.here.com/parking/facilities.json");
  url.searchParams.set("prox", `${FLATIRON.lat},${FLATIRON.lng},1000`);
  url.searchParams.set("maxresults", "20");
  url.searchParams.set("sortkey", "parking_space_free");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 120 }, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new ProviderError("timeout");
    throw new ProviderError("network");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new ProviderError("http_error");
  let data: unknown;
  try { data = await response.json(); } catch { throw new ProviderError("invalid_payload"); }
  const records: unknown[] = [];
  const freeSpaces: number[] = [];
  const visit = (value: unknown, key = "") => {
    if (Array.isArray(value)) { value.forEach((item) => visit(item, key)); return; }
    if (!value || typeof value !== "object") return;
    Object.entries(value).forEach(([childKey, childValue]) => {
      if (Array.isArray(childValue) && /facilit/i.test(childKey)) records.push(...childValue);
      if (typeof childValue === "number" && /parking.*(free|available)|free.*parking/i.test(childKey)) freeSpaces.push(childValue);
      visit(childValue, childKey);
    });
  };
  visit(data);
  if (!records.length && !freeSpaces.length) throw new ProviderError("invalid_payload");
  return {
    value: { nearbyFacilities: records.length, reportedFreeSpaces: freeSpaces.length ? freeSpaces.reduce((sum, value) => sum + value, 0) : null },
    dataAsOf: null,
    records: Math.max(records.length, freeSpaces.length),
  };
}

function unavailableMeta(provider: ProviderName, refreshSeconds: number, fetchedAt: string, error: unknown): ProviderMeta {
  return {
    provider, status: "unavailable", fetchedAt, dataAsOf: null, refreshSeconds, responseMs: null, records: null,
    errorCode: error instanceof ProviderError ? error.code : "network",
  };
}

async function capture<T>(provider: ProviderName, refreshSeconds: number, operation: () => Promise<{ value: T; dataAsOf: string | null; records: number }>) {
  const started = Date.now();
  const fetchedAt = new Date().toISOString();
  try {
    const result = await operation();
    return {
      value: result.value,
      meta: {
        provider, status: result.records === 0 ? "no-data" : "live", fetchedAt, dataAsOf: result.dataAsOf,
        refreshSeconds, responseMs: Date.now() - started, records: result.records,
      } satisfies ProviderMeta,
    };
  } catch (error) {
    return { value: null, meta: unavailableMeta(provider, refreshSeconds, fetchedAt, error) };
  }
}

/** Fetches live exogenous features. Provider failures are isolated and explicitly documented. */
export async function getParkingContext(): Promise<ParkingContext> {
  const [weather, traffic, events, parking] = await Promise.all([
    capture("open-meteo", 300, getWeather),
    capture("nyc-dot", 120, getTraffic),
    capture("nyc-open-data", 300, getEvents),
    capture("here-parking", 120, getHereParking),
  ]);
  const liveProviders = [weather.meta, traffic.meta, events.meta, parking.meta].filter((meta) => meta.status === "live" || meta.status === "no-data").length;
  return {
    schemaVersion: "1.1",
    observedAt: new Date().toISOString(),
    weather: weather.value ?? { temperatureF: null, precipitationInches: null, weatherCode: null, precipitationProbability: null },
    traffic: traffic.value ?? { medianMph: null, sampledLinks: 0 },
    events: { activeOrUpcoming: events.value ?? 0 },
    parking: parking.value ?? { nearbyFacilities: 0, reportedFreeSpaces: null },
    sources: { weather: weather.value ? "open-meteo" : "unavailable", traffic: traffic.value ? "nyc-dot" : "unavailable", events: events.value !== null ? "nyc-open-data" : "unavailable", parking: parking.value ? "here" : "unavailable" },
    provenance: { weather: weather.meta, traffic: traffic.meta, events: events.meta, parking: parking.meta },
    quality: { status: liveProviders === 4 ? "live" : liveProviders === 0 ? "unavailable" : "degraded", liveProviders, totalProviders: 4 },
  };
}
