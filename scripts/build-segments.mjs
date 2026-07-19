import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Builds curb-segment geometry for the Flatiron grid. Each block face becomes a
 * short polyline with a side (north/south/east/west), regulation rules, and
 * ticket stats inherited from the nearest real FY2026 street aggregate. The app
 * treats these segments as the tappable objects — no draggable pin.
 *
 * Geometry is a rotated grid (~29° east of north, matching the Manhattan street
 * grid) anchored near 23rd & Broadway. It is representative, not surveyed.
 */

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(scriptDirectory, "../data");

const ORIGIN = { lat: 40.7411, lng: -73.9897 }; // ~23rd & Broadway
const THETA = (29 * Math.PI) / 180; // uptown bearing (east of north)
const BLOCK_NS = 81; // meters between numbered streets
const HALF_WIDTH = 7; // meters from centerline to a curb face

// Avenues west -> east, with east-offset (meters) from Broadway's line.
const AVENUES = [
  { name: "6th Ave", east: -300 },
  { name: "5th Ave", east: -150 },
  { name: "Broadway", east: 0 },
  { name: "Park Ave S", east: 150 },
];
const STREET_NUMBERS = [18, 19, 20, 21, 22, 23, 24];

// Rotation: uptown unit U and eastward unit V, expressed as (north, east) meters.
const U = { north: Math.cos(THETA), east: Math.sin(THETA) };
const V = { north: -Math.sin(THETA), east: Math.cos(THETA) };

function offset(base, north, east) {
  return {
    lat: base.lat + north / 111_000,
    lng: base.lng + east / (111_000 * Math.cos((base.lat * Math.PI) / 180)),
  };
}

// Intersection of numbered street `s` and avenue index `a`.
function intersection(s, a) {
  const up = (s - 23) * BLOCK_NS;
  const across = AVENUES[a].east;
  const north = up * U.north + across * V.north;
  const east = up * U.east + across * V.east;
  return offset(ORIGIN, north, east);
}

function shift(point, vec, meters) {
  return offset(point, vec.north * meters, vec.east * meters);
}

// Deterministic RNG seeded from a string so rebuilds are stable.
function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri
const MON_SAT = [1, 2, 3, 4, 5, 6];

// Assign a regulation profile to a segment from its seeded RNG. Avenues lean
// metered with rush-hour no-standing; cross streets lean metered + alternate-side
// street cleaning.
function makeRegulation(rng, isAvenue, ticketWeight) {
  const rules = [];
  let base = "free";
  let meter = null;

  if (isAvenue) {
    const roll = rng();
    if (roll < 0.18 + ticketWeight * 0.2) {
      // High-demand avenue face: all-day no standing.
      base = "no_standing_all_day";
      rules.push({ type: "no_standing", days: MON_SAT, start: 7, end: 19, label: "No Standing 7a–7p" });
    } else {
      base = rng() < 0.5 ? "commercial_metered" : "metered";
      meter = { days: MON_SAT, start: 9, end: 19, rate: base === "commercial_metered" ? 5.5 : 4.5 };
      // Rush-hour no standing on one commute side.
      if (rng() < 0.55) {
        const pm = rng() < 0.5;
        rules.push(
          pm
            ? { type: "no_standing", days: WEEKDAYS, start: 16, end: 19, label: "No Standing 4–7p (Mon–Fri)" }
            : { type: "no_standing", days: WEEKDAYS, start: 7, end: 10, label: "No Standing 7–10a (Mon–Fri)" },
        );
      }
    }
  } else {
    const roll = rng();
    if (roll < 0.5) {
      base = "metered";
      meter = { days: MON_SAT, start: 9, end: 19, rate: 4.5 };
    }
    // Alternate-side street cleaning window on most cross-street faces.
    if (rng() < 0.8) {
      const days = rng() < 0.5 ? [2, 5] : [1, 4]; // Tue/Fri or Mon/Thu
      const morning = rng() < 0.5;
      rules.push(
        morning
          ? { type: "street_cleaning", days, start: 8, end: 9.5, label: "Street Cleaning 8–9:30a" }
          : { type: "street_cleaning", days, start: 11.5, end: 13, label: "Street Cleaning 11:30a–1p" },
      );
    }
  }

  return { base, meter, rules };
}

async function main() {
  const violations = JSON.parse(
    await readFile(path.join(dataDirectory, "violations.json"), "utf8"),
  );

  function longitudeScale(lat) {
    return 111_000 * Math.cos((lat * Math.PI) / 180);
  }
  function nearestAnchor(lat, lng) {
    let best = null;
    for (const entry of violations) {
      const dNorth = (entry.lat - lat) * 111_000;
      const dEast = (entry.lng - lng) * longitudeScale(lat);
      const dist = Math.hypot(dNorth, dEast);
      if (!best || dist < best.dist) best = { entry, dist };
    }
    return best.entry;
  }

  const segments = [];

  function pushFace({ id, street, fromCross, toCross, axis, a, b, sides }) {
    for (const side of sides) {
      const p1 = shift(a, side.vec, HALF_WIDTH);
      const p2 = shift(b, side.vec, HALF_WIDTH);
      const mid = { lat: (p1.lat + p2.lat) / 2, lng: (p1.lng + p2.lng) / 2 };
      const anchor = nearestAnchor(mid.lat, mid.lng);
      const segId = `${id}-${side.key}`;
      const rng = mulberry32(hashString(segId));
      const ticketWeight = Math.min(1, anchor.count / 16000);
      const regulation = makeRegulation(rng, axis === "ns", ticketWeight);

      // Ticket stats: inherit the nearest real aggregate, jittered per face.
      const jitter = 0.55 + rng() * 0.9;
      const count = Math.round(anchor.count * jitter * (axis === "ns" ? 1 : 0.7));

      const crossPrefix = side.crossPrefix;
      const shortFrom = fromCross.replace(/ St$/, "");
      const shortTo = toCross.replace(/ St$/, "");
      const label =
        axis === "ns"
          ? `${street} between ${crossPrefix}${shortFrom} & ${crossPrefix}${shortTo} — ${side.name} side`
          : `${street} between ${fromCross} & ${toCross} — ${side.name} side`;

      segments.push({
        id: segId,
        pairId: id,
        street,
        fromCross: `${crossPrefix}${fromCross}`.trim(),
        toCross: `${crossPrefix}${toCross}`.trim(),
        side: side.name,
        axis,
        label,
        coords: [
          [Number(p1.lat.toFixed(6)), Number(p1.lng.toFixed(6))],
          [Number(p2.lat.toFixed(6)), Number(p2.lng.toFixed(6))],
        ],
        regulation,
        count,
        avgFine: anchor.avgFine,
        topViolation: anchor.topViolation,
      });
    }
  }

  // Avenue block faces: run along U between consecutive streets. West/east sides.
  for (let a = 0; a < AVENUES.length; a += 1) {
    const avenue = AVENUES[a];
    const westOf5th = a < 1 || (a === 1 ? true : false); // 6th Ave & 5th Ave use W for their west side
    for (let i = 0; i < STREET_NUMBERS.length - 1; i += 1) {
      const s1 = STREET_NUMBERS[i];
      const s2 = STREET_NUMBERS[i + 1];
      const pA = intersection(s1, a);
      const pB = intersection(s2, a);
      // Cross-street prefix: west of 5th uses W; 5th Ave splits (west side=W, east side=E); else E.
      const sides = [
        {
          key: "W",
          name: "west",
          vec: { north: -V.north, east: -V.east },
          crossPrefix: a <= 1 ? "W " : "E ",
        },
        {
          key: "E",
          name: "east",
          vec: { north: V.north, east: V.east },
          crossPrefix: a < 1 ? "W " : "E ",
        },
      ];
      pushFace({
        id: `${avenue.name.replace(/\s+/g, "")}-${s1}-${s2}`,
        street: avenue.name,
        fromCross: `${s1}${ordinal(s1)} St`,
        toCross: `${s2}${ordinal(s2)} St`,
        axis: "ns",
        a: pA,
        b: pB,
        sides,
      });
      void westOf5th;
    }
  }

  // Cross-street block faces: run along V between consecutive avenues. North/south.
  for (let s = 0; s < STREET_NUMBERS.length; s += 1) {
    const num = STREET_NUMBERS[s];
    for (let a = 0; a < AVENUES.length - 1; a += 1) {
      const pA = intersection(num, a);
      const pB = intersection(num, a + 1);
      const westward = a < 1; // between 6th & 5th -> "W", else "E"
      const streetName = `${westward ? "W" : "E"} ${num}${ordinal(num)} St`;
      const sides = [
        {
          key: "N",
          name: "north",
          vec: { north: U.north, east: U.east },
          crossPrefix: "",
        },
        {
          key: "S",
          name: "south",
          vec: { north: -U.north, east: -U.east },
          crossPrefix: "",
        },
      ];
      pushFace({
        id: `${streetName.replace(/\s+/g, "")}-${AVENUES[a].name.replace(/\s+/g, "")}-${AVENUES[a + 1].name.replace(/\s+/g, "")}`,
        street: streetName,
        fromCross: AVENUES[a].name,
        toCross: AVENUES[a + 1].name,
        axis: "ew",
        a: pA,
        b: pB,
        sides,
      });
    }
  }

  await writeFile(
    path.join(dataDirectory, "segments.json"),
    `${JSON.stringify(segments, null, 2)}\n`,
  );
  console.log(`Wrote ${segments.length} curb segments.`);
}

function ordinal(n) {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return "st";
  if (rem10 === 2 && rem100 !== 12) return "nd";
  if (rem10 === 3 && rem100 !== 13) return "rd";
  return "th";
}

await main();
