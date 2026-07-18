# ticketdodge

Predicts your parking ticket risk from 1M+ real NYC violations.

`ticketdodge` is a zero-config Next.js 14 hackathon app with a full-screen OpenStreetMap map of Flatiron, NYC. Search for a nearby street or click the map to see a 0–100 ticket-risk score, historical enforcement patterns, common fines, and a quick parking recommendation.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Swap in real data

Replace `/data/violations.json` with an aggregation from the NYC Open Data parking-violations dataset. Keep each row in this shape:

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

The app reads that file through `/lib/data.ts`; `/lib/score.ts` automatically normalizes the new counts into the 0–100 risk scale. No API key or environment configuration is required.
