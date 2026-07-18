import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DATASET_ID = "pvqr-7yc4";
const DATASET_URL = `https://data.cityofnewyork.us/resource/${DATASET_ID}.json`;
const DATASET_PAGE = `https://data.cityofnewyork.us/d/${DATASET_ID}`;
const FINE_SCHEDULE_URL =
  "https://www.nyc.gov/site/finance/vehicles/services-violation-codes.page";
const PRECINCT = 13;

const streetPoints = [
  { street: "5th Ave", lat: 40.7416, lng: -73.9912 },
  { street: "Park Ave South", lat: 40.7394, lng: -73.9873 },
  { street: "E 18th St", lat: 40.738, lng: -73.989 },
  { street: "Broadway", lat: 40.7408, lng: -73.9895 },
  { street: "E 20th St", lat: 40.7389, lng: -73.9894 },
  { street: "E 21st St", lat: 40.7398, lng: -73.989 },
  { street: "W 20th St", lat: 40.7402, lng: -73.9921 },
  { street: "W 24th St", lat: 40.7434, lng: -73.9911 },
];

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const fineByCode = {
  14: 115,
  31: 115,
  38: 65,
  69: 65,
};

const readableViolation = {
  14: "General No Standing",
  31: "Commercial Meter Zone",
  38: "Meter Receipt Not Displayed",
  69: "Commercial Meter Receipt Not Displayed",
};

const streetFilter = `(${streetPoints.map(({ street }) => `'${street}'`).join(",")})`;

async function query(select, group, order, extraWhere = "") {
  const url = new URL(DATASET_URL);
  url.searchParams.set("$select", select);
  url.searchParams.set(
    "$where",
    `violation_precinct = ${PRECINCT} AND street_name IN ${streetFilter}${extraWhere}`,
  );
  url.searchParams.set("$group", group);
  if (order) url.searchParams.set("$order", order);
  url.searchParams.set("$limit", "50000");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`NYC Open Data request failed (${response.status})`);
  }
  return response.json();
}

function keepLargest(map, key, candidate, count) {
  const existing = map.get(key);
  if (!existing || count > existing.count) map.set(key, { ...candidate, count });
}

function parseViolationHour(value) {
  const match = /^(\d{2})\d{2}([AP])$/.exec(value ?? "");
  if (!match) return null;
  const baseHour = Number(match[1]) % 12;
  return baseHour + (match[2] === "P" ? 12 : 0);
}

const totals = await query(
  "street_name, count(*) as ticket_count",
  "street_name",
  "ticket_count DESC",
);
const violationGroups = await query(
  "street_name, violation_description, count(*) as violation_count",
  "street_name, violation_description",
  "street_name, violation_count DESC",
  " AND violation_description IS NOT NULL",
);
const dayGroups = await query(
  "street_name, date_extract_dow(issue_date) as dow, count(*) as ticket_count",
  "street_name, dow",
  "street_name, ticket_count DESC",
);
const timeGroups = await query(
  "street_name, violation_time, count(*) as ticket_count",
  "street_name, violation_time",
  null,
  " AND violation_time IS NOT NULL",
);

const totalByStreet = new Map(
  totals.map((row) => [row.street_name, Number(row.ticket_count)]),
);
const topViolationByStreet = new Map();
for (const row of violationGroups) {
  const code = Number.parseInt(row.violation_description, 10);
  keepLargest(
    topViolationByStreet,
    row.street_name,
    { code, description: row.violation_description },
    Number(row.violation_count),
  );
}

const peakDayByStreet = new Map();
for (const row of dayGroups) {
  keepLargest(
    peakDayByStreet,
    row.street_name,
    { dow: Number(row.dow) },
    Number(row.ticket_count),
  );
}

const hourlyCounts = new Map();
for (const row of timeGroups) {
  const hour = parseViolationHour(row.violation_time);
  if (hour === null) continue;
  const key = `${row.street_name}|${hour}`;
  hourlyCounts.set(key, (hourlyCounts.get(key) ?? 0) + Number(row.ticket_count));
}

const peakHourByStreet = new Map();
for (const [key, count] of hourlyCounts) {
  const [street, hour] = key.split("|");
  keepLargest(peakHourByStreet, street, { hour: Number(hour) }, count);
}

const violations = streetPoints.map((point) => {
  const topViolation = topViolationByStreet.get(point.street);
  const peakDay = peakDayByStreet.get(point.street);
  const peakHour = peakHourByStreet.get(point.street);

  if (!topViolation || !peakDay || !peakHour || !totalByStreet.has(point.street)) {
    throw new Error(`Missing aggregation for ${point.street}`);
  }

  return {
    street: point.street,
    lat: point.lat,
    lng: point.lng,
    day: days[peakDay.dow],
    hour: peakHour.hour,
    count: totalByStreet.get(point.street),
    topViolation:
      readableViolation[topViolation.code] ?? topViolation.description,
    avgFine: fineByCode[topViolation.code] ?? 65,
  };
});

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(scriptDirectory, "../data");
await mkdir(dataDirectory, { recursive: true });
await writeFile(
  path.join(dataDirectory, "violations.json"),
  `${JSON.stringify(violations, null, 2)}\n`,
);
await writeFile(
  path.join(dataDirectory, "source.json"),
  `${JSON.stringify(
    {
      dataset: "Parking Violations Issued - Fiscal Year 2026",
      datasetId: DATASET_ID,
      datasetUrl: DATASET_PAGE,
      fineScheduleUrl: FINE_SCHEDULE_URL,
      precinct: PRECINCT,
      pulledAt: new Date().toISOString(),
      methodology:
        "Street-level FY2026 ticket totals, peak weekday/hour, and most common violation for eight Flatiron-area streets in Precinct 13. Coordinates are representative map points. Risk scoring remains a heuristic.",
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${violations.length} real-data street aggregates.`);
