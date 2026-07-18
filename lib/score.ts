import { getNearestViolation, violations } from "@/lib/data";

const getNormalizedCount = (count: number) => {
  const counts = violations.map((entry) => entry.count);
  const minimum = Math.min(...counts);
  const maximum = Math.max(...counts);

  if (maximum === minimum) return count > 0 ? 100 : 0;
  return Math.round(((count - minimum) / (maximum - minimum)) * 100);
};

const getProfileCount = (lat: number, lng: number, day: string, hour: number) => {
  const match = getNearestViolation(lat, lng, day, hour);
  const profileCount = match.citationProfile?.find(
    (entry) => entry.day === day && entry.hour === hour,
  )?.count;
  // Older checked-in snapshots may not yet contain the profile. Retain a
  // deterministic fallback until `npm run data:refresh` is run.
  return { match, count: profileCount ?? match.count / (7 * 24) };
};

const getHourDifference = (a: number, b: number) => {
  const difference = Math.abs(a - b);
  return Math.min(difference, 24 - difference);
};

/**
 * Returns a 0–100 risk score for the closest matching street and time window.
 * Counts are min/max normalized across the current violations dataset.
 */
export function getRisk(
  lat: number,
  lng: number,
  day: string,
  hour: number,
  durationMinutes = 60,
) {
  const { count } = getProfileCount(lat, lng, day, hour);
  const profileCounts = violations.flatMap((entry) => entry.citationProfile?.map((profile) => profile.count) ?? []);
  const hourlyRisk = (profileCounts.length ? normalize(count, profileCounts) : getNormalizedCount(count)) / 100;
  const exposureHours = durationMinutes / 60;
  const adjustedRisk = 1 - (1 - hourlyRisk) ** exposureHours;

  return Math.round(adjustedRisk * 100);
}

export function getRiskBreakdown(
  lat: number,
  lng: number,
  day: string,
  hour: number,
  durationMinutes: number,
) {
  const { match, count } = getProfileCount(lat, lng, day, hour);
  const hourDifference = getHourDifference(match.hour, hour);
  const sameDay = match.day === day;
  const timeStrength = Math.max(
    10,
    Math.round((sameDay ? 100 : 58) - hourDifference * (sameDay ? 7 : 3)),
  );

  return [
    {
      label: "Enforcement history",
      detail: `${Math.round(count).toLocaleString()} citations in this window`,
      strength: profileCountsForRisk(count),
    },
    {
      label: "Time overlap",
      detail: `Peak ${match.day.slice(0, 3)} at ${formatHour(match.hour)}`,
      strength: timeStrength,
    },
    {
      label: "Parking exposure",
      detail: formatDuration(durationMinutes),
      // Scale to overnight (12 hr) so 5 hr / overnight stays are distinguishable.
      strength: Math.min(100, Math.round((durationMinutes / (12 * 60)) * 100)),
    },
  ];
}

function normalize(count: number, values: number[]) {
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return maximum === minimum ? (count > 0 ? 100 : 0) : Math.round(((count - minimum) / (maximum - minimum)) * 100);
}

function profileCountsForRisk(count: number) {
  const values = violations.flatMap((entry) => entry.citationProfile?.map((profile) => profile.count) ?? []);
  return values.length ? normalize(count, values) : getNormalizedCount(count);
}

export function getConfidence(count: number) {
  if (count >= 10_000) return "High";
  if (count >= 5_000) return "Medium";
  return "Low";
}

export function getSaferAlternative(
  lat: number,
  lng: number,
  day: string,
  hour: number,
  durationMinutes: number,
) {
  const current = getNearestViolation(lat, lng, day, hour);
  const currentRisk = getRisk(lat, lng, day, hour, durationMinutes);
  const longitudeScale = 111_000 * Math.cos((lat * Math.PI) / 180);

  const alternatives = violations
    .filter((entry) => entry.street !== current.street)
    .map((entry) => {
      const northSouthMeters = (entry.lat - lat) * 111_000;
      const eastWestMeters = (entry.lng - lng) * longitudeScale;
      const distanceMeters = Math.hypot(northSouthMeters, eastWestMeters);
      const score = getRisk(
        entry.lat,
        entry.lng,
        day,
        hour,
        durationMinutes,
      );

      return { entry, score, distanceMeters };
    })
    .filter(({ score }) => score < currentRisk)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  const alternative = alternatives[0];
  if (!alternative) return null;

  return {
    ...alternative,
    blocksAway: Math.max(1, Math.round(alternative.distanceMeters / 90)),
  };
}

function formatHour(hour: number) {
  const normalized = hour % 24;
  return `${normalized % 12 || 12}${normalized >= 12 ? "pm" : "am"}`;
}

function formatDuration(durationMinutes: number) {
  if (durationMinutes >= 12 * 60) return "overnight";
  if (durationMinutes < 60) return `${durationMinutes} minutes`;
  if (durationMinutes === 60) return "1 hour";
  return `${durationMinutes / 60} hours`;
}
