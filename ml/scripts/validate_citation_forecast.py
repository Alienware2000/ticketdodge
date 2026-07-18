#!/usr/bin/env python3
"""Validate a saved held-out citation forecast exported as CSV.

Expected columns: citation_count, zero_probability, mean, dispersion.
"""

from __future__ import annotations

import argparse
import json

import pandas as pd

from parking_ml.evaluation import evaluate_citation_forecast


def main() -> None:
    parser = argparse.ArgumentParser(description="Score held-out ZINB citation forecasts.")
    parser.add_argument("csv", help="CSV containing held-out target and ZINB parameters")
    parser.add_argument("--peak-quantile", type=float, default=0.9, help="Quantile used for aggregate peak-period recall")
    args = parser.parse_args()
    table = pd.read_csv(args.csv)
    required = {"citation_count", "zero_probability", "mean", "dispersion"}
    missing = sorted(required.difference(table.columns))
    if missing:
        parser.error(f"missing required columns: {', '.join(missing)}")
    metrics = evaluate_citation_forecast(
        table["citation_count"].to_numpy(),
        table["zero_probability"].to_numpy(),
        table["mean"].to_numpy(),
        table["dispersion"].to_numpy(),
        peak_quantile=args.peak_quantile,
    )
    print(json.dumps(metrics.to_dict(), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
