import torch
import typer
from pathlib import Path
import soundfile as sf
from tokenizer.thai_phonemizer import ThaiPhonemizer
from models.acoustic_model import AcousticModel
from models.vocoder import Vocoder

app = typer.Typer()

def load_models(ckpt: Path | None, voc_ckpt: Path | None, device: str):
    ph = ThaiPhonemizer(use_pythainlp=False)
    am = AcousticModel(vocab_size=ph.vocab_size).to(device).eval()
    voc = Vocoder().to(device).eval()
    if ckpt and ckpt.exists(): am.load_state_dict(torch.load(ckpt, map_location=device))
    if voc_ckpt and voc_ckpt.exists(): voc.load_state_dict(torch.load(voc_ckpt, map_location=device))
    return ph, am, voc

def synthesize(text: str, ckpt: Path | None = None, voc_ckpt: Path | None = None, device: str | None = None) -> tuple[torch.Tensor, int]:
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    ph, am, voc = load_models(ckpt, voc_ckpt, device)
    ids = torch.tensor([ph.encode(text)], dtype=torch.long, device=device)
    with torch.no_grad():
        mel = am.inference(ids)
        wav = voc(mel).squeeze(0).cpu()
    return wav, 22050

@app.command()
def main(
    text: str = typer.Argument(..., help="Thai text to synthesize"),
    out: Path = typer.Option("output.wav"),
    ckpt: Path = typer.Option(None, help="Acoustic model checkpoint"),
    voc_ckpt: Path = typer.Option(None, help="Vocoder checkpoint"),
):
    wav, sr = synthesize(text, ckpt, voc_ckpt)
    sf.write(str(out), wav.numpy(), sr)
    typer.echo(f"wrote {out} ({wav.numel()/sr:.2f}s @ {sr}Hz)")

if __name__ == "__main__":
    app()
