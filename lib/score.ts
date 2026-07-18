import { getNearestViolation, violations } from "@/lib/data";

const getNormalizedCount = (count: number) => {
  const counts = violations.map((entry) => entry.count);
  const maximum = Math.max(...counts);

  if (maximum === 0) return 0;
  return Math.round((count / maximum) * 100);
};

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const getHourDifference = (a: number, b: number) => {
  const difference = Math.abs(a - b);
  return Math.min(difference, 24 - difference);
};

const getDayDifference = (a: string, b: string) => {
  const aIndex = Math.max(0, days.indexOf(a));
  const bIndex = Math.max(0, days.indexOf(b));
  const difference = Math.abs(aIndex - bIndex);
  return Math.min(difference, 7 - difference);
};

const getTemporalStrength = (
  peakDay: string,
  peakHour: number,
  day: string,
  hour: number,
) => {
  const dayProximity = 1 - getDayDifference(peakDay, day) / 6;
  const hourProximity = 1 - getHourDifference(peakHour, hour) / 18;
  return 0.72 + dayProximity * 0.12 + hourProximity * 0.16;
};

/**
 * Returns a 0–100 risk score for the closest matching street and time window.
 * Ticket volume is normalized against the busiest street, then adjusted by
 * how closely the requested day/hour overlaps that street's real peak window.
 * This is an enforcement index, not an individual ticket probability.
 */
export function getRisk(
  lat: number,
  lng: number,
  day: string,
  hour: number,
  durationMinutes = 60,
) {
  const match = getNearestViolation(lat, lng, day, hour);
  const hourlyRisk =
    (getNormalizedCount(match.count) / 100) *
    getTemporalStrength(match.day, match.hour, day, hour);
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
  const match = getNearestViolation(lat, lng, day, hour);
  const timeStrength = Math.round(
    getTemporalStrength(match.day, match.hour, day, hour) * 100,
  );

  return [
    {
      label: "Enforcement history",
      detail: `${match.count.toLocaleString()} nearby tickets`,
      strength: getNormalizedCount(match.count),
    },
    {
      label: "Time overlap",
      detail: `Peak ${match.day.slice(0, 3)} at ${formatHour(match.hour)}`,
      strength: timeStrength,
    },
    {
      label: "Parking exposure",
      detail: formatDuration(durationMinutes),
      strength: Math.min(100, Math.round((durationMinutes / 120) * 100)),
    },
  ];
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
  if (durationMinutes < 60) return `${durationMinutes} minutes`;
  return `${durationMinutes / 60} ${durationMinutes === 60 ? "hour" : "hours"}`;
}
