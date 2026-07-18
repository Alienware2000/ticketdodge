import { getNearestViolation, violations, type ViolationEntry } from "@/lib/data";
import { getRisk } from "@/lib/score";

export type ParkingPreferences = {
  maxWalkBlocks: number;
  maxSearchMinutes: number;
  riskTolerance: "low" | "medium" | "high";
  isInAHurry: boolean;
};

export type TrafficContext = {
  searchMultiplier: number;
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
  walkMinutes: number;
  searchMinutes: number;
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
export function getAvailabilityEstimate(entry: ViolationEntry, day: string, hour: number) {
  const baseRisk = getRisk(entry.lat, entry.lng, day, hour, 60);
  const commutePressure = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 19) ? 13 : 0;
  const eventPressure = (day === "Saturday" || day === "Sunday") && hour >= 11 && hour <= 17 ? 8 : 0;
  const citationPressure = Math.round(baseRisk * 0.38);
  return Math.max(8, Math.min(92, 82 - citationPressure - commutePressure - eventPressure));
}

export function getParkingOptions(
  lat: number,
  lng: number,
  day: string,
  hour: number,
  durationMinutes: number,
  preferences: ParkingPreferences,
  traffic: TrafficContext = { searchMultiplier: 1 },
) {
  const toleranceMultiplier = preferences.riskTolerance === "low" ? 1.22 : preferences.riskTolerance === "high" ? 0.82 : 1;
  const hourlyMeterRate = 4.5;

  return violations
    .map((entry) => {
      const blocksAway = Math.max(0, Math.round(distanceInMeters(lat, lng, entry) / METERS_PER_BLOCK));
      const restriction = entry.topViolation;
      const ticketRisk = getRisk(
        entry.lat,
        entry.lng,
        day,
        hour,
        durationMinutes,
      );
      const availability = getAvailabilityEstimate(entry, day, hour);
      const meterCost = (durationMinutes / 60) * hourlyMeterRate;
      const expectedTicketCost =
        (ticketRisk / 100) *
        entry.avgFine *
        toleranceMultiplier *
        restrictionMultiplier(restriction);
      const expectedTowCost = (ticketRisk / 100) * (restriction.toLowerCase().includes("no standing") ? 22 : 5);
      const walkMinutes = blocksAway * 2;
      const walkingCost = walkMinutes * (preferences.isInAHurry ? 1.25 : 0.38);
      const searchMinutes = Math.max(
        1,
        Math.round(((100 - availability) / 12) * traffic.searchMultiplier),
      );
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
        walkMinutes,
        searchMinutes,
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
  const betterOption =
    options.find(
      (option) =>
        option.entry.street !== current.entry.street &&
        option.totalExpectedCost < current.totalExpectedCost,
    ) ?? options.find((option) => option.entry.street !== current.entry.street);
  const expectedSavings = betterOption ? Math.max(0, current.totalExpectedCost - betterOption.totalExpectedCost) : 0;
  const chanceOfImprovement = betterOption ? betterOption.availability / 100 : 0;
  const additionalSearchMinutes = betterOption
    ? Math.min(
        preferences.maxSearchMinutes,
        betterOption.searchMinutes + Math.ceil(betterOption.blocksAway * 0.75),
      )
    : 0;
  const searchPenalty = Math.max(
    1.5,
    additionalSearchMinutes * (preferences.isInAHurry ? 2.5 : 0.7),
  );
  const shouldKeepSearching =
    expectedSavings >= 15 &&
    chanceOfImprovement * expectedSavings > searchPenalty &&
    additionalSearchMinutes <= preferences.maxSearchMinutes &&
    !preferences.isInAHurry;
  const currentExposure = current.expectedTicketCost + current.expectedTowCost;
  const betterExposure = betterOption
    ? betterOption.expectedTicketCost + betterOption.expectedTowCost
    : currentExposure;
  const modeledExposureReduction = Math.max(0, currentExposure - betterExposure);

  return {
    shouldKeepSearching,
    betterOption,
    expectedSavings,
    chanceOfImprovement,
    additionalSearchMinutes,
    modeledExposureReduction,
    message: shouldKeepSearching
      ? `Try ${betterOption?.entry.street} — the modeled advantage is worth one short search loop.`
      : `Park here — another loop is unlikely to repay the extra time.`,
  };
}

export function getCurrentParkingOption(
  lat: number,
  lng: number,
  day: string,
  hour: number,
  durationMinutes: number,
  preferences: ParkingPreferences,
  traffic: TrafficContext = { searchMultiplier: 1 },
) {
  const currentEntry = getNearestViolation(lat, lng, day, hour);
  return getParkingOptions(lat, lng, day, hour, durationMinutes, {
    ...preferences,
    maxWalkBlocks: Number.MAX_SAFE_INTEGER,
  }, traffic).find((option) => option.entry.street === currentEntry.street)!;
}
