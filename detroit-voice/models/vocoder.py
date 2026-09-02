import torch
import torch.nn as nn

class ResBlock(nn.Module):
    def __init__(self, ch: int, k: int = 3, d: int = 1):
        super().__init__()
        self.conv = nn.Sequential(
            nn.LeakyReLU(0.1),
            nn.Conv1d(ch, ch, k, padding=(k - 1) * d // 2, dilation=d),
            nn.LeakyReLU(0.1),
            nn.Conv1d(ch, ch, k, padding=(k - 1) // 2),
        )

    def forward(self, x): return x + self.conv(x)

class Vocoder(nn.Module):
    def __init__(self, n_mels: int = 80, upsample_rates=[8, 8, 2, 2], upsample_kernels=[16, 16, 4, 4]):
        super().__init__()
        self.pre = nn.Conv1d(n_mels, 512, 7, padding=3)
        ch = 512
        ups, res = [], []
        for r, k in zip(upsample_rates, upsample_kernels):
            ups.append(nn.ConvTranspose1d(ch, ch // 2, k, stride=r, padding=(k - r) // 2))
            res.append(ResBlock(ch // 2))
            ch //= 2
        self.ups = nn.ModuleList(ups)
        self.res = nn.ModuleList(res)
        self.post = nn.Sequential(nn.LeakyReLU(0.1), nn.Conv1d(ch, 1, 7, padding=3), nn.Tanh())

    def forward(self, mel: torch.Tensor) -> torch.Tensor:
        x = self.pre(mel)
        for up, rb in zip(self.ups, self.res):
            x = up(x)
            x = rb(x)
        return self.post(x).squeeze(1)
