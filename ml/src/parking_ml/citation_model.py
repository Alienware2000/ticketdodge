"""NYC-native citation-intensity forecasting with a zero-inflated NB head.

Parking citations are counts: many segment/time cells have no citations, while
enforcement bursts produce a long tail. A Gaussian regression target would be
miscalibrated, so the model predicts a structural-zero probability, mean, and
dispersion for a zero-inflated negative-binomial distribution.
"""

from __future__ import annotations

import torch
from torch import Tensor, nn

from .model import GraphTemporalBlock


class CitationGraphFormer(nn.Module):
    """Forecasts per-segment citation distributions at multiple horizons."""

    def __init__(self, nodes: int, exogenous_features: int, horizons: int = 4, width: int = 96, layers: int = 3) -> None:
        super().__init__()
        self.nodes = nodes
        self.horizons = horizons
        self.input_projection = nn.Linear(1 + exogenous_features, width)
        self.blocks = nn.ModuleList([GraphTemporalBlock(width, heads=4, nodes=nodes, dropout=0.1) for _ in range(layers)])
        self.horizon_embedding = nn.Parameter(torch.randn(horizons, width) * 0.02)
        self.head = nn.Sequential(nn.Linear(width * 2, width), nn.GELU(), nn.Linear(width, 3))

    def forward(self, count_history: Tensor, exogenous_history: Tensor, adjacency: Tensor) -> tuple[Tensor, Tensor, Tensor]:
        # count_history [B,T,N], exogenous_history [B,T,N,F]
        x = self.input_projection(torch.cat((torch.log1p(count_history).unsqueeze(-1), exogenous_history), dim=-1))
        for block in self.blocks:
            x = block(x, adjacency)
        last = x[:, -1, None].expand(-1, self.horizons, -1, -1)
        horizon = self.horizon_embedding[None, :, None].expand(x.shape[0], -1, self.nodes, -1)
        raw = self.head(torch.cat((last, horizon), dim=-1))
        zero_probability = torch.sigmoid(raw[..., 0])
        mean = torch.nn.functional.softplus(raw[..., 1]).clamp_min(1e-5)
        dispersion = torch.nn.functional.softplus(raw[..., 2]).clamp_min(1e-5)
        return zero_probability, mean, dispersion


def zinb_negative_log_likelihood(
    target: Tensor,
    zero_probability: Tensor,
    mean: Tensor,
    dispersion: Tensor,
) -> Tensor:
    """Stable negative log likelihood for the ZINB count distribution."""
    theta = dispersion
    log_nb = (
        torch.lgamma(target + theta)
        - torch.lgamma(theta)
        - torch.lgamma(target + 1)
        + theta * (torch.log(theta) - torch.log(theta + mean))
        + target * (torch.log(mean) - torch.log(theta + mean))
    )
    zero_log_prob = torch.logaddexp(torch.log(zero_probability), torch.log1p(-zero_probability) + log_nb)
    log_prob = torch.where(target == 0, zero_log_prob, torch.log1p(-zero_probability) + log_nb)
    return -log_prob.mean()


def expected_citations(zero_probability: Tensor, mean: Tensor) -> Tensor:
    """The decision-service point forecast while retaining distributional output."""
    return (1 - zero_probability) * mean
