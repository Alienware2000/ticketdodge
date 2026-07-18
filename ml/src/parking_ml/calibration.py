"""Distribution-free post-hoc calibration for forecast intervals."""

from __future__ import annotations

import numpy as np


class SplitConformalCalibrator:
    """Widens P10/P90 bands to obtain finite-sample marginal coverage."""

    def __init__(self, target_coverage: float = 0.8) -> None:
        self.target_coverage = target_coverage
        self.radius: float | None = None

    def fit(self, lower: np.ndarray, upper: np.ndarray, observed: np.ndarray) -> "SplitConformalCalibrator":
        nonconformity = np.maximum(lower - observed, observed - upper)
        rank = min(1.0, np.ceil((len(nonconformity) + 1) * self.target_coverage) / len(nonconformity))
        self.radius = float(np.quantile(nonconformity, rank, method="higher"))
        return self

    def apply(self, lower: np.ndarray, upper: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        if self.radius is None:
            raise RuntimeError("Fit the conformal calibrator before applying it")
        return np.clip(lower - self.radius, 0, 1), np.clip(upper + self.radius, 0, 1)
