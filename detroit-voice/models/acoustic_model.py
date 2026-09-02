import torch
import torch.nn as nn
import torch.nn.functional as F
from .text_encoder import TextEncoder
from .duration_predictor import DurationPredictor

def _expand(h: torch.Tensor, durations: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    out, masks = [], []
    for b in range(h.size(0)):
        rep = torch.repeat_interleave(h[b], durations[b].clamp(min=0), dim=0)
        out.append(rep)
        masks.append(torch.ones(rep.size(0), dtype=torch.bool, device=h.device))
    max_len = max(x.size(0) for x in out)
    padded = torch.stack([F.pad(x, (0, 0, 0, max_len - x.size(0))) for x in out])
    mask = torch.stack([F.pad(m, (0, max_len - m.size(0))) for m in masks])
    return padded, mask

class AcousticModel(nn.Module):
    def __init__(self, vocab_size: int = 128, d_model: int = 256, n_mels: int = 80):
        super().__init__()
        self.encoder = TextEncoder(vocab_size, d_model)
        self.duration_predictor = DurationPredictor(d_model)
        self.decoder = nn.TransformerEncoder(
            nn.TransformerEncoderLayer(d_model, 4, d_model * 4, batch_first=True), num_layers=4
        )
        self.mel_proj = nn.Linear(d_model, n_mels)
        self.n_mels = n_mels

    def forward(self, phoneme_ids: torch.Tensor, mel_target: torch.Tensor | None = None, durations: torch.Tensor | None = None):
        mask = phoneme_ids != 0
        h = self.encoder(phoneme_ids, mask)
        log_d = self.duration_predictor(h, mask)
        if durations is None:
            durations = self.duration_predictor.infer(h, mask)
        h_exp, _ = _expand(h, durations)
        dec = self.decoder(h_exp)
        mel = self.mel_proj(dec).transpose(1, 2)
        return {"mel": mel, "log_d": log_d, "durations": durations}

    @torch.no_grad()
    def inference(self, phoneme_ids: torch.Tensor) -> torch.Tensor:
        return self.forward(phoneme_ids)["mel"]
