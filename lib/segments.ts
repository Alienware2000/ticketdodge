import rawSegments from "@/data/segments.json";

export type LatLng = { lat: number; lng: number };

export type RegulationRule = {
  type: "no_standing" | "no_parking" | "street_cleaning";
  days: number[]; // 0 = Sunday … 6 = Saturday
  start: number; // hour, may be fractional (11.5 = 11:30)
  end: number;
  label: string;
};

export type Meter = {
  days: number[];
  start: number;
  end: number;
  rate: number;
};

export type Segment = {
  id: string;
  pairId: string;
  street: string;
  fromCross: string;
  toCross: string;
  side: "north" | "south" | "east" | "west";
  axis: "ns" | "ew";
  label: string;
  coords: [number, number][];
  regulation: {
    base: string;
    meter: Meter | null;
    rules: RegulationRule[];
  };
  count: number;
  avgFine: number;
  topViolation: string;
};

export const segments = rawSegments as Segment[];

export const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export type StatusTone = "green" | "yellow" | "red" | "blue";

export type SegmentStatus = {
  tone: StatusTone;
  /** Short label, e.g. "No Standing now". */
  label: string;
  /** Fuller sentence for the panel. */
  detail: string;
  /** Hour (float) when the current state ends / changes, if known. */
  changesAt: number | null;
};

export const STATUS_TONES: Record<
  StatusTone,
  { color: string; label: string; icon: string; shape: string }
> = {
  // Colours double-encoded with an icon/shape so they survive colour-blindness.
  green: { color: "#16a34a", label: "Legal now", icon: "✓", shape: "circle" },
  yellow: { color: "#d97706", label: "Restriction soon", icon: "!", shape: "triangle" },
  red: { color: "#dc2626", label: "No standing / parking", icon: "✕", shape: "square" },
  blue: { color: "#2563eb", label: "Metered", icon: "$", shape: "diamond" },
};

export function dayIndex(day: string) {
  const idx = DAYS.indexOf(day);
  return idx < 0 ? 0 : idx;
}

export function formatHour(hour: number) {
  const normalized = ((hour % 24) + 24) % 24;
  const whole = Math.floor(normalized);
  const minutes = Math.round((normalized - whole) * 60);
  const suffix = whole >= 12 ? "pm" : "am";
  const displayHour = whole % 12 || 12;
  return minutes
    ? `${displayHour}:${String(minutes).padStart(2, "0")}${suffix}`
    : `${displayHour}${suffix}`;
}

function ruleActive(rule: RegulationRule, dayIdx: number, hour: number) {
  return rule.days.includes(dayIdx) && hour >= rule.start && hour < rule.end;
}

/**
 * Resolves a segment's status for a day + hour + intended stay. Precedence:
 * an active no-standing/cleaning rule → red; a rule starting within the stay
 * (or the next hour) → yellow; an active meter → blue; otherwise green.
 */
export function getSegmentStatus(
  segment: Segment,
  dayIdx: number,
  hour: number,
  durationMinutes: number,
): SegmentStatus {
  const { rules, meter } = segment.regulation;

  const active = rules.find((rule) => ruleActive(rule, dayIdx, hour));
  if (active) {
    return {
      tone: "red",
      label: active.type === "street_cleaning" ? "Street cleaning now" : "No standing now",
      detail: `${active.label} — active until ${formatHour(active.end)}.`,
      changesAt: active.end,
    };
  }

  const lookaheadHours = Math.max(1, durationMinutes / 60);
  const upcoming = rules
    .filter((rule) => rule.days.includes(dayIdx) && rule.start > hour && rule.start - hour <= lookaheadHours)
    .sort((a, b) => a.start - b.start)[0];
  if (upcoming) {
    const minutes = Math.round((upcoming.start - hour) * 60);
    return {
      tone: "yellow",
      label: "Restriction soon",
      detail: `${upcoming.label} starts in ${minutes} min (${formatHour(upcoming.start)}).`,
      changesAt: upcoming.start,
    };
  }

  if (meter && meter.days.includes(dayIdx) && hour >= meter.start && hour < meter.end) {
    return {
      tone: "blue",
      label: "Metered",
      detail: `Pay at the meter (~$${meter.rate.toFixed(2)}/hr) until ${formatHour(meter.end)}.`,
      changesAt: meter.end,
    };
  }

  // Legal — surface when it next turns restricted, if that is later today.
  const nextRule = rules
    .filter((rule) => rule.days.includes(dayIdx) && rule.start > hour)
    .sort((a, b) => a.start - b.start)[0];
  const meterLater = meter && meter.days.includes(dayIdx) && meter.start > hour ? meter.start : null;
  const nextChange =
    nextRule && meterLater != null
      ? Math.min(nextRule.start, meterLater)
      : nextRule
        ? nextRule.start
        : meterLater;

  return {
    tone: "green",
    label: "Legal now",
    detail: nextChange != null
      ? `Free and legal until ${formatHour(nextChange)}.`
      : "Free and legal for your stay.",
    changesAt: nextChange ?? null,
  };
}

const EARTH = 111_000;
function lngScale(lat: number) {
  return EARTH * Math.cos((lat * Math.PI) / 180);
}

// Distance (m) from a point to a segment's polyline.
function distanceToSegment(lat: number, lng: number, segment: Segment) {
  let best = Infinity;
  for (let i = 0; i < segment.coords.length - 1; i += 1) {
    const [aLat, aLng] = segment.coords[i];
    const [bLat, bLng] = segment.coords[i + 1];
    const scale = lngScale(lat);
    const ax = (aLng - lng) * scale;
    const ay = (aLat - lat) * EARTH;
    const bx = (bLng - lng) * scale;
    const by = (bLat - lat) * EARTH;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy || 1;
    let t = -(ax * dx + ay * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx;
    const py = ay + t * dy;
    best = Math.min(best, Math.hypot(px, py));
  }
  return best;
}

export function snapToSegment(lat: number, lng: number): Segment {
  let best: { segment: Segment; dist: number } | null = null;
  for (const segment of segments) {
    const dist = distanceToSegment(lat, lng, segment);
    if (!best || dist < best.dist) best = { segment, dist };
  }
  return best!.segment;
}

/** Returns up to `limit` snap candidates ordered by distance — used when GPS is fuzzy. */
export function candidateSegments(lat: number, lng: number, limit = 3): Segment[] {
  return segments
    .map((segment) => ({ segment, dist: distanceToSegment(lat, lng, segment) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, limit)
    .map((entry) => entry.segment);
}

export function getById(id: string): Segment | undefined {
  return segments.find((segment) => segment.id === id);
}

/** The same block face on the other side of the street, if it exists. */
export function oppositeSide(segment: Segment): Segment | null {
  return segments.find((other) => other.pairId === segment.pairId && other.id !== segment.id) ?? null;
}

export function segmentCenter(segment: Segment): LatLng {
  const coords = segment.coords;
  const mid = coords[Math.floor(coords.length / 2)] ?? coords[0];
  return { lat: mid[0], lng: mid[1] };
}

export function metersBetween(a: LatLng, b: LatLng) {
  return Math.hypot((b.lat - a.lat) * EARTH, (b.lng - a.lng) * lngScale(a.lat));
}

export type NearbySegment = {
  segment: Segment;
  status: SegmentStatus;
  blocksAway: number;
  meters: number;
};

/** Nearest legal-leaning alternatives to a chosen segment, best-status first. */
export function nearbySegments(
  segment: Segment,
  dayIdx: number,
  hour: number,
  durationMinutes: number,
  limit = 4,
): NearbySegment[] {
  const from = segmentCenter(segment);
  const toneRank: Record<StatusTone, number> = { green: 0, blue: 1, yellow: 2, red: 3 };

  return segments
    .filter((other) => other.pairId !== segment.pairId)
    .map((other) => {
      const meters = metersBetween(from, segmentCenter(other));
      return {
        segment: other,
        status: getSegmentStatus(other, dayIdx, hour, durationMinutes),
        blocksAway: Math.max(1, Math.round(meters / 81)),
        meters,
      };
    })
    .sort((a, b) => {
      const tone = toneRank[a.status.tone] - toneRank[b.status.tone];
      if (tone !== 0) return tone;
      return a.meters - b.meters;
    })
    .slice(0, limit);
}
