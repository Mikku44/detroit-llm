import json
from pathlib import Path
import torch
from torch.utils.data import Dataset
from tokenizer.thai_phonemizer import ThaiPhonemizer

class TTSDataset(Dataset):
    def __init__(self, manifest: str | Path, phonemizer: ThaiPhonemizer | None = None):
        self.phonemizer = phonemizer or ThaiPhonemizer(use_pythainlp=False)
        path = Path(manifest)
        self.items = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()] if path.exists() else []

    def __len__(self): return len(self.items)

    def __getitem__(self, i: int):
        it = self.items[i]
        text = it.get("text", "")
        ids = torch.tensor(self.phonemizer.encode(text), dtype=torch.long)
        mel = torch.randn(80, 64)
        if "mel_path" in it:
            try: mel = torch.load(it["mel_path"], map_location="cpu")
            except Exception: pass
        duration = torch.ones(len(ids), dtype=torch.long)
        return {"phoneme_ids": ids, "mel": mel, "duration": duration, "text": text}

def collate(batch):
    max_p = max(b["phoneme_ids"].size(0) for b in batch)
    max_m = max(b["mel"].size(1) for b in batch)
    pids, mels, durs, texts = [], [], [], []
    for b in batch:
        p = torch.nn.functional.pad(b["phoneme_ids"], (0, max_p - b["phoneme_ids"].size(0)))
        m = torch.nn.functional.pad(b["mel"], (0, max_m - b["mel"].size(1)))
        d = torch.nn.functional.pad(b["duration"], (0, max_p - b["duration"].size(0)))
        pids.append(p); mels.append(m); durs.append(d); texts.append(b["text"])
    return {"phoneme_ids": torch.stack(pids), "mel": torch.stack(mels), "duration": torch.stack(durs), "text": texts}
