"""Leakage-safe evaluation utilities for citation-intensity forecasts.

The metrics in this module are deliberately small and framework-independent.
They let a training job produce an auditable held-out report before a model
artifact is considered for product use.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import lgamma

import numpy as np


@dataclass(frozen=True)
class CitationForecastMetrics:
    """Metrics for a held-out segment/time-cell forecast."""

    negative_log_likelihood: float
    mean_absolute_error: float
    peak_recall: float
    peak_threshold: float
    observed_zero_rate: float
    predicted_zero_rate: float
    cells: int

    def to_dict(self) -> dict[str, float | int]:
        """Return JSON-serializable metrics for a model card or CI artifact."""
        return asdict(self)


def _as_finite_array(value: np.ndarray | list[float], name: str) -> np.ndarray:
    array = np.asarray(value, dtype=float)
    if array.size == 0:
        raise ValueError(f"{name} must contain at least one value")
    if not np.isfinite(array).all():
        raise ValueError(f"{name} must contain only finite values")
    return array


def zinb_log_probability(
    target: np.ndarray | list[float], zero_probability: np.ndarray | list[float], mean: np.ndarray | list[float], dispersion: np.ndarray | list[float]
) -> np.ndarray:
    """Compute stable ZINB log probabilities with NumPy arrays.

    This mirrors :func:`parking_ml.citation_model.zinb_negative_log_likelihood`
    and is intended for offline validation, independent of PyTorch.
    """
    target_array = _as_finite_array(target, "target")
    zero = _as_finite_array(zero_probability, "zero_probability")
    mean_array = _as_finite_array(mean, "mean")
    dispersion_array = _as_finite_array(dispersion, "dispersion")
    try:
        target_array, zero, mean_array, dispersion_array = np.broadcast_arrays(target_array, zero, mean_array, dispersion_array)
    except ValueError as error:
        raise ValueError("target and forecast parameters must be broadcast-compatible") from error
    if (target_array < 0).any() or not np.equal(target_array, np.floor(target_array)).all():
        raise ValueError("target must contain non-negative integer citation counts")
    if ((zero <= 0) | (zero >= 1)).any():
        raise ValueError("zero_probability must be strictly between 0 and 1")
    if (mean_array <= 0).any() or (dispersion_array <= 0).any():
        raise ValueError("mean and dispersion must be positive")

    # np.vectorize keeps this dependency-light while math.lgamma is precise.
    vectorized_lgamma = np.vectorize(lgamma)
    log_nb = (
        vectorized_lgamma(target_array + dispersion_array)
        - vectorized_lgamma(dispersion_array)
        - vectorized_lgamma(target_array + 1)
        + dispersion_array * (np.log(dispersion_array) - np.log(dispersion_array + mean_array))
        + target_array * (np.log(mean_array) - np.log(dispersion_array + mean_array))
    )
    zero_log_prob = np.logaddexp(np.log(zero), np.log1p(-zero) + log_nb)
    return np.where(target_array == 0, zero_log_prob, np.log1p(-zero) + log_nb)


def evaluate_citation_forecast(
    target: np.ndarray | list[float],
    zero_probability: np.ndarray | list[float],
    mean: np.ndarray | list[float],
    dispersion: np.ndarray | list[float],
    peak_quantile: float = 0.9,
) -> CitationForecastMetrics:
    """Score a held-out ZINB forecast without turning it into driver-level risk.

    ``peak_recall`` asks whether the highest predicted *expected citation*
    cells capture observed high-count cells. It is an operational signal for
    aggregate enforcement intensity, not a claim about individual tickets.
    """
    if not 0 < peak_quantile < 1:
        raise ValueError("peak_quantile must be strictly between 0 and 1")
    target_array = _as_finite_array(target, "target")
    zero = _as_finite_array(zero_probability, "zero_probability")
    mean_array = _as_finite_array(mean, "mean")
    dispersion_array = _as_finite_array(dispersion, "dispersion")
    target_array, zero, mean_array, dispersion_array = np.broadcast_arrays(target_array, zero, mean_array, dispersion_array)
    log_probability = zinb_log_probability(target_array, zero, mean_array, dispersion_array)
    expected = (1 - zero) * mean_array
    threshold = float(np.quantile(target_array, peak_quantile))
    observed_peak = target_array >= threshold
    predicted_peak = expected >= np.quantile(expected, peak_quantile)
    peak_recall = float((observed_peak & predicted_peak).sum() / observed_peak.sum())
    return CitationForecastMetrics(
        negative_log_likelihood=float(-log_probability.mean()),
        mean_absolute_error=float(np.abs(target_array - expected).mean()),
        peak_recall=peak_recall,
        peak_threshold=threshold,
        observed_zero_rate=float((target_array == 0).mean()),
        predicted_zero_rate=float(zero.mean()),
        cells=int(target_array.size),
    )
