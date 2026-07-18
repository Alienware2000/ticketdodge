# ticketdodge

Predicts your parking ticket risk from 1M+ real NYC violations.

`ticketdodge` is a zero-config Next.js 14 hackathon app with a full-screen OpenStreetMap map of Flatiron, NYC. Search for a nearby street or click the map, choose how long you plan to park, and see a 0–100 enforcement-risk score, safe-until guidance, an explainable breakdown, and a lower-risk nearby option.

The checked-in data snapshot contains real street-level FY2026 ticket aggregates from the NYC Department of Finance for eight Flatiron-area streets in Precinct 13. Coordinates are representative points, and the 0–100 risk calculation is still a hackathon heuristic—not an individual probability of receiving a ticket.

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

The app reads that file through `/lib/data.ts`; `/lib/score.ts` automatically normalizes the new counts into the 0–100 heuristic scale. No API key or environment configuration is required.
