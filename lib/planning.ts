import { getNearestViolation, violations, type ViolationEntry } from "@/lib/data";
import { getRisk } from "@/lib/score";
import type { ParkingContext } from "@/lib/parking-context";

export type ParkingPreferences = {
  maxWalkBlocks: number;
  maxSearchMinutes: number;
  riskTolerance: "low" | "medium" | "high";
  isInAHurry: boolean;
};

export type ParkingOption = {
  entry: ViolationEntry;
  blocksAway: number;
  availability: number;
  ticketRisk: number;
  meterCost: number;
  expectedTicketCost: number;
  expectedTowCost: number;
  walkingCost: number;
  searchCost: number;
  totalExpectedCost: number;
  restriction: string;
};

const METERS_PER_BLOCK = 90;

function distanceInMeters(lat: number, lng: number, target: ViolationEntry) {
  const longitudeScale = 111_000 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(
    (target.lat - lat) * 111_000,
    (target.lng - lng) * longitudeScale,
  );
}

function restrictionMultiplier(restriction: string) {
  const normalized = restriction.toLowerCase();
  if (normalized.includes("no standing") || normalized.includes("no parking")) return 1.24;
  if (normalized.includes("commercial")) return 1.14;
  if (normalized.includes("meter")) return 1.06;
  return 1;
}

/**
 * A transparent local estimate, not a live curb feed. Citation activity is the
 * primary signal; commute periods approximate traffic, and weekend midday
 * approximates event demand. These factors can be replaced with live feeds.
 */
export function getAvailabilityEstimate(
  entry: ViolationEntry,
  day: string,
  hour: number,
  context?: ParkingContext | null,
) {
  const baseRisk = getRisk(entry.lat, entry.lng, day, hour, 60);
  const commutePressure = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19) ? 13 : 0;
  const eventPressure = (day === "Saturday" || day === "Sunday") && hour >= 11 && hour <= 17 ? 8 : 0;
  const citationPressure = Math.round(baseRisk * 0.38);
  const rainPressure = (context?.weather.precipitationProbability ?? 0) >= 45 ? 7 : 0;
  const trafficPressure = context?.traffic.medianMph !== null && context?.traffic.medianMph !== undefined && context.traffic.medianMph < 12 ? 6 : 0;
  const liveEventPressure = Math.min(12, (context?.events.activeOrUpcoming ?? 0) * 2);
  return Math.max(8, Math.min(92, 82 - citationPressure - commutePressure - eventPressure - rainPressure - trafficPressure - liveEventPressure));
}

export function getParkingOptions(
  lat: number,
  lng: number,
  day: string,
  hour: number,
  durationMinutes: number,
  preferences: ParkingPreferences,
  context?: ParkingContext | null,
) {
  const toleranceMultiplier = preferences.riskTolerance === "low" ? 1.22 : preferences.riskTolerance === "high" ? 0.82 : 1;
  const hourlyMeterRate = 4.5;

  return violations
    .map((entry) => {
      const blocksAway = Math.max(0, Math.round(distanceInMeters(lat, lng, entry) / METERS_PER_BLOCK));
      const restriction = entry.topViolation;
      const ticketRisk = Math.min(
        99,
        Math.round(getRisk(entry.lat, entry.lng, day, hour, durationMinutes) * restrictionMultiplier(restriction)),
      );
      const availability = getAvailabilityEstimate(entry, day, hour, context);
      const meterCost = (durationMinutes / 60) * hourlyMeterRate;
      const expectedTicketCost = (ticketRisk / 100) * entry.avgFine * toleranceMultiplier;
      const expectedTowCost = (ticketRisk / 100) * (restriction.toLowerCase().includes("no standing") ? 22 : 5);
      const walkingCost = blocksAway * (preferences.isInAHurry ? 2 : 0.75);
      const searchMinutes = Math.max(1, Math.round((100 - availability) / 12));
      const searchCost = searchMinutes * (preferences.isInAHurry ? 2.5 : 0.7);
      return {
        entry,
        blocksAway,
        availability,
        ticketRisk,
        meterCost,
        expectedTicketCost,
        expectedTowCost,
        walkingCost,
        searchCost,
        totalExpectedCost: meterCost + expectedTicketCost + expectedTowCost + walkingCost + searchCost,
        restriction,
      } satisfies ParkingOption;
    })
    .filter((option) => option.blocksAway <= preferences.maxWalkBlocks)
    .sort((a, b) => a.totalExpectedCost - b.totalExpectedCost);
}

export function getStopRecommendation(
  current: ParkingOption,
  options: ParkingOption[],
  preferences: ParkingPreferences,
) {
  const betterOption = options.find((option) => option.entry.street !== current.entry.street);
  const expectedSavings = betterOption ? Math.max(0, current.totalExpectedCost - betterOption.totalExpectedCost) : 0;
  const chanceOfImprovement = betterOption ? betterOption.availability / 100 : 0;
  const searchPenalty = Math.max(1.5, (preferences.isInAHurry ? 3 : 1) * Math.min(preferences.maxSearchMinutes, 10) / 3);
  const shouldKeepSearching = chanceOfImprovement * expectedSavings > searchPenalty && !preferences.isInAHurry;

  return {
    shouldKeepSearching,
    betterOption,
    expectedSavings,
    chanceOfImprovement,
    message: shouldKeepSearching
      ? `Keep searching for up to ${preferences.maxSearchMinutes} min — a better nearby curb is likely worth about $${expectedSavings.toFixed(0)} in expected cost.`
      : `Park here — the likely savings from continuing do not beat the time and uncertainty of searching.`,
  };
}

export function getCurrentParkingOption(
  lat: number,
  lng: number,
  day: string,
  hour: number,
  durationMinutes: number,
  preferences: ParkingPreferences,
  context?: ParkingContext | null,
) {
  const currentEntry = getNearestViolation(lat, lng, day, hour);
  return getParkingOptions(lat, lng, day, hour, durationMinutes, {
    ...preferences,
    maxWalkBlocks: Math.max(preferences.maxWalkBlocks, 99),
  }, context).find((option) => option.entry.street === currentEntry.street)!;
}
