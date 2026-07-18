# CurbGraphFormer

This package contains trainable parking models. It is intentionally separate from the Next.js app: online inference should load a versioned model artifact, while training and feature backfills run in a dedicated Python environment.

## Model

`CurbGraphFormer` combines temporal self-attention with both physical and learned graph edges between block faces. It emits P10/P50/P90 occupancy forecasts at 5-, 10-, and 15-minute horizons. Split conformal calibration then adjusts the P10/P90 band against a held-out time period. The product should recommend more searching only when the expected gain exceeds the cost *and* the lower confidence bound supports it.

This design is grounded in published parking work showing graph/temporal models can combine meter, traffic, and weather signals, and in newer efficient spatiotemporal graph-transformer work. It is more capable than a per-block regression while still practical for a city-scale graph.

## Required training table

One row per `(observed_at, block_face_id)` at 5-minute cadence:

```text
observed_at,block_face_id,occupancy_fraction,paid_sessions,traffic_mph,temperature_f,precipitation_probability,active_events,restriction_embedding_id
```

`occupancy_fraction` is the supervised label: occupied spaces / legal spaces. Paid sessions may be a feature but is not a substitute for occupancy unless its relationship to legal capacity is validated.

## Graph edges

Build edges from: same intersection, adjacent road segment, walkable distance, shared traffic link, and empirically learned demand correlation. Keep edge types/weights in a versioned graph artifact; do not infer a graph afresh at serving time.

## Training gates

Do not ship the neural forecast until there are enough labels for a time-based holdout and calibration split. Report MAE, pinball loss, interval coverage, and performance by neighborhood/time-of-day. Compare against seasonal historical median and a gradient-boosted tree baseline.

## Initial setup

```bash
cd ml
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
```

## Availability-model status

Do not train or market this model as NYC availability prediction until NYC block-level occupancy labels are available. A cross-city sensor dataset can be useful for architecture experiments, but it is not an acceptable accuracy claim for New York because curb rules, capacity, demand, and enforcement differ materially by city.

For the hackathon, the trainable NYC ML feature is citation-intensity forecasting, using the City's own historical parking-violation records as the supervised target. Keep availability as a transparent, non-ML contextual estimate until it has a local target dataset.

## NYC citation model (active)

`CitationGraphFormer` is the NYC-native model to train first. It uses a graph-temporal encoder and a zero-inflated negative-binomial output head to predict the full distribution of citations for every street-segment/time cell. That is important because citation counts are both sparse and bursty; a plain regression would systematically understate enforcement spikes.

Target: `citation_count` per `(street_segment_id, 15-minute window)`. Features: historical citation lags, weekday/holiday, time window, violation/restriction class, weather, NYC DOT traffic speed, nearby permitted-event count, meter rate, and parking-sign attributes. Report held-out time-split negative log likelihood, MAE, peak-period recall, and calibration—not an unsupported probability that a specific driver gets a ticket.
