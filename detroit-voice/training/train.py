import typer
import torch
from pathlib import Path
from torch.utils.data import DataLoader
from tokenizer.thai_phonemizer import ThaiPhonemizer
from models.acoustic_model import AcousticModel
from training.dataset import TTSDataset, collate
from training.loss import TTSLoss

app = typer.Typer()

@app.command()
def main(
    manifest: Path = typer.Option("dataset/manifest.json", help="JSONL manifest"),
    out_dir: Path = typer.Option("checkpoints", help="Checkpoint dir"),
    epochs: int = 10,
    batch_size: int = 8,
    lr: float = 1e-4,
    device: str = "cuda" if torch.cuda.is_available() else "cpu",
):
    phonemizer = ThaiPhonemizer(use_pythainlp=False)
    ds = TTSDataset(manifest, phonemizer)
    if len(ds) == 0:
        typer.echo(f"No data at {manifest}, using dummy batch for smoke test")
        ds.items = [{"text": "สวัสดีครับ"}] * 16
    loader = DataLoader(ds, batch_size=batch_size, shuffle=True, collate_fn=collate)
    model = AcousticModel(vocab_size=phonemizer.vocab_size).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=lr)
    criterion = TTSLoss()
    out_dir.mkdir(parents=True, exist_ok=True)
    for epoch in range(1, epochs + 1):
        model.train()
        total = 0
        for batch in loader:
            pids = batch["phoneme_ids"].to(device)
            mel = batch["mel"].to(device)
            dur = batch["duration"].to(device)
            pred = model(pids, durations=dur)
            loss, logs = criterion(pred, {"mel": mel, "duration": dur})
            opt.zero_grad(); loss.backward(); opt.step()
            total += logs["total"]
        avg = total / max(len(loader), 1)
        typer.echo(f"epoch {epoch}/{epochs} loss={avg:.4f}")
        torch.save(model.state_dict(), out_dir / f"epoch{epoch}.pt")
    typer.echo(f"done -> {out_dir}")

if __name__ == "__main__":
    app()
