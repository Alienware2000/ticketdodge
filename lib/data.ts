import rawViolations from "@/data/violations.json";
import rawDataSource from "@/data/source.json";

export type ViolationEntry = {
  street: string;
  lat: number;
  lng: number;
  day: string;
  hour: number;
  count: number;
  topViolation: string;
  avgFine: number;
};

export const violations: ViolationEntry[] = rawViolations;
export const dataSource = rawDataSource;
export const totalTickets = violations.reduce(
  (total, entry) => total + entry.count,
  0,
);

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function cyclicDifference(a: number, b: number, cycle: number) {
  const difference = Math.abs(a - b);
  return Math.min(difference, cycle - difference);
}

/**
 * Finds the closest block. Day/hour act as small tie-breakers so a click or
 * street search always stays anchored to the location the driver selected.
 */
export function getNearestViolation(
  lat: number,
  lng: number,
  day: string,
  hour: number,
) {
  const requestedDay = Math.max(0, days.indexOf(day));

  return violations.reduce((nearest, entry) => {
    const entryDay = Math.max(0, days.indexOf(entry.day));
    const distance =
      (entry.lat - lat) ** 2 * 1_000_000 +
      (entry.lng - lng) ** 2 * 1_000_000;
    const dayDifference = cyclicDifference(entryDay, requestedDay, 7);
    const hourDifference = cyclicDifference(entry.hour, hour, 24);
    const matchCost = distance + dayDifference * 0.01 + hourDifference * 0.001;

    if (!nearest || matchCost < nearest.matchCost) {
      return { entry, matchCost };
    }

    return nearest;
  }, null as { entry: ViolationEntry; matchCost: number } | null)!.entry;
}

export function findStreet(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  return (
    violations.find((entry) => entry.street.toLowerCase() === normalized) ??
    violations.find((entry) => entry.street.toLowerCase().startsWith(normalized)) ??
    violations.find((entry) => entry.street.toLowerCase().includes(normalized)) ??
    null
  );
}

export const streetNames = Array.from(
  new Set(violations.map((entry) => entry.street)),
);
