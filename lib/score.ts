import { getNearestViolation, violations } from "@/lib/data";

/**
 * Returns a 0–100 risk score for the closest matching street and time window.
 * Counts are min/max normalized across the current violations dataset.
 */
export function getRisk(lat: number, lng: number, day: string, hour: number) {
  const match = getNearestViolation(lat, lng, day, hour);
  const counts = violations.map((entry) => entry.count);
  const minimum = Math.min(...counts);
  const maximum = Math.max(...counts);

  if (maximum === minimum) return match.count > 0 ? 100 : 0;

  return Math.round(((match.count - minimum) / (maximum - minimum)) * 100);
}
