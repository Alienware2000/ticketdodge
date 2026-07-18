# ticketdodge

Helps NYC drivers stop circling sooner and avoid high-enforcement curbs.

`ticketdodge` is a zero-config Next.js 14 hackathon app with a full-screen OpenStreetMap map of Flatiron, NYC. Search for a nearby street or click the map, choose how long you plan to park, and see a 0–100 enforcement-risk score, safe-until guidance, an explainable breakdown, and a lower-risk nearby option.

The checked-in snapshot contains **59,027 real FY2026 parking tickets** aggregated across eight Flatiron-area streets in Precinct 13. Coordinates are representative points, and the 0–100 enforcement-risk calculation is a transparent hackathon index—not an individual probability of receiving a ticket.

## Save money + time story

TicketDodge compares the curb in front of a driver with nearby alternatives and gives one glanceable decision: **park here** or **search one more block**. It shows the scheduled fine at stake, modeled cost reduction, and estimated search time separately so the recommendation never hides time inside a single dollar number.

- **Money:** avoid streets with heavier historical enforcement and common $65–$115 violations.
- **Time:** stop circling when the modeled advantage of another block no longer repays the search time.
- **Live context:** the server reads the latest public NYC DOT traffic-speed snapshot and uses it only to adjust search friction. Traffic never changes the ticket-risk index.

## What is real vs. estimated

| Signal | Provenance |
| --- | --- |
| Street ticket totals, peak day/hour, top violation | NYC Open Data FY2026 |
| Fine amount | NYC Department of Finance schedule |
| Nearby approach speed | Latest NYC DOT Traffic Speeds snapshot |
| Risk index, parking opportunity, search time, modeled cost | Clearly labeled heuristic outputs |
| Map coordinates | Representative Flatiron points |

Peak weekday and peak hour are independently aggregated. “Parking opportunity” is not live curb occupancy, and the product never claims otherwise.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Refresh the NYC Open Data snapshot

```bash
npm run data:refresh
```

This queries the official [Parking Violations Issued – Fiscal Year 2026](https://data.cityofnewyork.us/d/pvqr-7yc4) dataset for Precinct 13 and rewrites `/data/violations.json`. Fine amounts come from the official [NYC Department of Finance violation-code schedule](https://www.nyc.gov/site/finance/vehicles/services-violation-codes.page). No API token is required for this focused aggregation.

## Swap in a different real-data slice

Adjust the street list, coordinates, or precinct in `/scripts/fetch-nyc-data.mjs`, or replace `/data/violations.json` with another NYC Open Data aggregation. Keep each row in this shape:

```ts
{
  street: string;
  lat: number;
  lng: number;
  day: string;
  hour: number;
  count: number;
  topViolation: string;
  avgFine: number;
}
```

The app reads that file through `/lib/data.ts`; `/lib/score.ts` normalizes each count against the busiest included street, adjusts it by proximity to the street’s peak day/hour, and increases exposure for longer stays. `/app/api/conditions/route.ts` reads the no-key NYC DOT feed. No API key or environment configuration is required.
