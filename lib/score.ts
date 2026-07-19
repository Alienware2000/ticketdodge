import {
  formatHour,
  segments,
  type Segment,
  type SegmentStatus,
  type StatusTone,
} from "@/lib/segments";

const counts = segments.map((entry) => entry.count);
const MIN_COUNT = Math.min(...counts);
const MAX_COUNT = Math.max(...counts);

function normalizedCount(count: number) {
  if (MAX_COUNT === MIN_COUNT) return count > 0 ? 100 : 0;
  return Math.round(((count - MIN_COUNT) / (MAX_COUNT - MIN_COUNT)) * 100);
}

/**
 * 0–100 ticket-risk for a segment given its live status and the intended stay.
 * Enforcement history sets the base rate; the current regulation status
 * dominates — an active No Standing is near-certain, a legal meter is low.
 */
export function getSegmentRisk(
  segment: Segment,
  status: SegmentStatus,
  durationMinutes: number,
) {
  const hourly = normalizedCount(segment.count) / 100;
  const exposure = Math.max(0.25, durationMinutes / 60);
  let risk = 1 - (1 - hourly) ** exposure;

  switch (status.tone) {
    case "red":
      risk = Math.max(risk, 0.9);
      break;
    case "yellow":
      risk = Math.max(risk * 0.9, 0.5);
      break;
    case "blue":
      risk *= 0.55; // paying the meter removes most exposure
      break;
    case "green":
      risk *= 0.45;
      break;
  }

  return Math.round(Math.min(1, risk) * 100);
}

export type Verdict = {
  tone: StatusTone;
  headline: string;
  sub: string;
};

/**
 * Leads with a plain-language verdict; the numeric score is demoted to support.
 */
export function getVerdict(
  score: number,
  status: SegmentStatus,
  safeUntil: string,
): Verdict {
  if (status.tone === "red") {
    return {
      tone: "red",
      headline: "High risk — likely ticket within minutes",
      sub: status.detail,
    };
  }
  if (status.tone === "yellow") {
    return {
      tone: "yellow",
      headline: `Park briefly — restriction starts ${status.changesAt != null ? `at ${formatHour(status.changesAt)}` : "soon"}`,
      sub: status.detail,
    };
  }
  if (status.tone === "blue") {
    return {
      tone: "blue",
      headline: "Metered — low risk if you pay",
      sub: `${status.detail} Skipping the meter is the likely ticket here.`,
    };
  }
  // Legal now — the score reflects how heavily this curb is historically ticketed.
  if (score > 66) {
    return {
      tone: "red",
      headline: "High risk — likely ticket within ~90 min",
      sub: "Legal right now, but heavily enforced here. Move on soon.",
    };
  }
  if (score >= 34) {
    return {
      tone: "yellow",
      headline: `Moderate risk — recheck by ${safeUntil}`,
      sub: "Legal now, but this curb gets ticketed often — keep an eye on the time.",
    };
  }
  return {
    tone: "green",
    headline: "Low risk — you're clear for now",
    sub: status.detail,
  };
}

export function getRiskBreakdown(
  segment: Segment,
  status: SegmentStatus,
  durationMinutes: number,
) {
  const statusStrength =
    status.tone === "red" ? 100 : status.tone === "yellow" ? 62 : status.tone === "blue" ? 34 : 16;

  return [
    {
      label: "Current regulation",
      detail: status.label,
      strength: statusStrength,
    },
    {
      label: "Enforcement history",
      detail: `${segment.count.toLocaleString()} nearby tickets`,
      strength: normalizedCount(segment.count),
    },
    {
      label: "Parking exposure",
      detail: durationMinutes < 60 ? `${durationMinutes} min` : `${durationMinutes / 60} hr`,
      strength: Math.min(100, Math.round((durationMinutes / 120) * 100)),
    },
  ];
}

export function getConfidence(count: number) {
  if (count >= 10_000) return "High";
  if (count >= 5_000) return "Medium";
  return "Low";
}
