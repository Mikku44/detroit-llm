import torch
import torch.nn as nn
import torch.nn.functional as F

class TTSLoss(nn.Module):
    def __init__(self, dur_weight: float = 0.1):
        super().__init__()
        self.dur_weight = dur_weight

    def forward(self, pred: dict, target: dict) -> tuple[torch.Tensor, dict]:
        mel_loss = F.l1_loss(pred["mel"], target["mel"])
        log_d = pred.get("log_d")
        if log_d is not None and "duration" in target:
            d = target["duration"].float().clamp(min=1)
            mask = target["duration"] > 0
            dur_loss = F.mse_loss(log_d[mask], torch.log(d[mask] + 1))
        else:
            dur_loss = torch.tensor(0.0, device=mel_loss.device)
        total = mel_loss + self.dur_weight * dur_loss
        return total, {"mel": mel_loss.item(), "duration": dur_loss.item(), "total": total.item()}
