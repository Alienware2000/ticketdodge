"""Graph-temporal quantile model for block-face parking availability.

The model accepts a history for every block face and learns two kinds of
dependence: attention over time and message passing over the curb graph. It
returns 10th/50th/90th-percentile occupancy forecasts for each horizon, so a
downstream decision policy can price uncertainty instead of treating a single
prediction as fact.
"""

from __future__ import annotations

import torch
from torch import Tensor, nn


class AdaptiveGraphMixer(nn.Module):
    """Mixes physical adjacency with a learned, asymmetric spillover graph."""

    def __init__(self, width: int, nodes: int) -> None:
        super().__init__()
        self.node_query = nn.Parameter(torch.randn(nodes, width) * 0.02)
        self.node_key = nn.Parameter(torch.randn(nodes, width) * 0.02)
        self.projection = nn.Linear(width, width)

    def forward(self, states: Tensor, adjacency: Tensor) -> Tensor:
        # states: [batch, time, nodes, width], adjacency: [nodes, nodes]
        learned = torch.softmax(self.node_query @ self.node_key.T, dim=-1)
        physical = adjacency / adjacency.sum(dim=-1, keepdim=True).clamp_min(1)
        graph = 0.7 * physical + 0.3 * learned
        return self.projection(torch.einsum("ij,btjw->btiw", graph, states))


class GraphTemporalBlock(nn.Module):
    def __init__(self, width: int, heads: int, nodes: int, dropout: float) -> None:
        super().__init__()
        self.temporal_attention = nn.MultiheadAttention(width, heads, dropout=dropout, batch_first=True)
        self.graph_mixer = AdaptiveGraphMixer(width, nodes)
        self.norm_time = nn.LayerNorm(width)
        self.norm_graph = nn.LayerNorm(width)
        self.ffn = nn.Sequential(nn.Linear(width, width * 4), nn.GELU(), nn.Dropout(dropout), nn.Linear(width * 4, width))
        self.norm_ffn = nn.LayerNorm(width)

    def forward(self, x: Tensor, adjacency: Tensor) -> Tensor:
        batch, time, nodes, width = x.shape
        temporal_input = x.transpose(1, 2).reshape(batch * nodes, time, width)
        temporal_output, _ = self.temporal_attention(temporal_input, temporal_input, temporal_input, need_weights=False)
        x = self.norm_time(x + temporal_output.reshape(batch, nodes, time, width).transpose(1, 2))
        x = self.norm_graph(x + self.graph_mixer(x, adjacency))
        return self.norm_ffn(x + self.ffn(x))


class CurbGraphFormer(nn.Module):
    """Multi-horizon block-face occupancy quantile forecaster."""

    def __init__(self, nodes: int, exogenous_features: int, horizons: int = 3, width: int = 96, layers: int = 3) -> None:
        super().__init__()
        self.horizons = horizons
        self.nodes = nodes
        self.input_projection = nn.Linear(1 + exogenous_features, width)
        self.blocks = nn.ModuleList([GraphTemporalBlock(width, heads=4, nodes=nodes, dropout=0.1) for _ in range(layers)])
        self.query = nn.Parameter(torch.randn(horizons, width) * 0.02)
        self.output = nn.Sequential(nn.Linear(width * 2, width), nn.GELU(), nn.Linear(width, 3))

    def forward(self, occupancy_history: Tensor, exogenous_history: Tensor, adjacency: Tensor) -> Tensor:
        # occupancy_history: [B, T, N]; exogenous_history: [B, T, N, F]
        x = self.input_projection(torch.cat((occupancy_history.unsqueeze(-1), exogenous_history), dim=-1))
        for block in self.blocks:
            x = block(x, adjacency)
        last_state = x[:, -1]  # [B, N, W]
        horizon_queries = self.query[None, :, None, :].expand(x.shape[0], -1, self.nodes, -1)
        state = last_state[:, None].expand(-1, self.horizons, -1, -1)
        # sigmoid constrains occupancy quantiles to [0, 1]. Sorting prevents crossings.
        return torch.sort(torch.sigmoid(self.output(torch.cat((state, horizon_queries), dim=-1))), dim=-1).values


def pinball_loss(prediction: Tensor, target: Tensor, quantiles: Tensor | None = None) -> Tensor:
    """Quantile-regression loss for [P10, P50, P90] occupancy predictions."""
    levels = quantiles if quantiles is not None else torch.tensor([0.1, 0.5, 0.9], device=prediction.device)
    error = target.unsqueeze(-1) - prediction
    return torch.maximum(levels * error, (levels - 1) * error).mean()
