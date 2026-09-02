import torch
import torch.nn as nn

class DurationPredictor(nn.Module):
    def __init__(self, d_model: int = 256, kernel_size: int = 3, dropout: float = 0.1):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv1d(d_model, d_model, kernel_size, padding=kernel_size // 2),
            nn.ReLU(),
            nn.LayerNorm(d_model),
            nn.Dropout(dropout),
            nn.Conv1d(d_model, d_model, kernel_size, padding=kernel_size // 2),
            nn.ReLU(),
            nn.LayerNorm(d_model),
            nn.Dropout(dropout),
        )
        self.proj = nn.Linear(d_model, 1)

    def forward(self, x: torch.Tensor, mask: torch.Tensor | None = None) -> torch.Tensor:
        h = x.transpose(1, 2)
        h = self.net[0](h).transpose(1, 2)
        h = self.net[1](h)
        h = self.net[2](h)
        h = self.net[3](h)
        h = h.transpose(1, 2)
        h = self.net[4](h).transpose(1, 2)
        h = self.net[5](h)
        h = self.net[6](h)
        h = self.net[7](h)
        out = self.proj(h).squeeze(-1)
        if mask is not None:
            out = out.masked_fill(~mask, 0)
        return out

    def infer(self, x: torch.Tensor, mask: torch.Tensor | None = None) -> torch.Tensor:
        log_d = self.forward(x, mask)
        d = torch.clamp((log_d.exp() - 1).round().long(), min=1)
        if mask is not None:
            d = d.masked_fill(~mask, 0)
        return d
