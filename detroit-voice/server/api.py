from fastapi import FastAPI
from fastapi.responses import Response
from pydantic import BaseModel
import torch, io, soundfile as sf
from tokenizer.thai_phonemizer import ThaiPhonemizer
from models.acoustic_model import AcousticModel
from models.vocoder import Vocoder

app = FastAPI(title="Detroit Voice API")
_ph = ThaiPhonemizer(use_pythainlp=False)
_device = "cuda" if torch.cuda.is_available() else "cpu"
_am = AcousticModel(vocab_size=_ph.vocab_size).to(_device).eval()
_voc = Vocoder().to(_device).eval()

class SynthesizeRequest(BaseModel):
    text: str
    sample_rate: int = 22050

@app.get("/health")
def health(): return {"status": "ok", "device": _device, "vocab_size": _ph.vocab_size}

@app.get("/phonemize")
def phonemize(text: str):
    return {"text": text, "phonemes": _ph.phonemize(text), "ids": _ph.encode(text)}

@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    ids = torch.tensor([_ph.encode(req.text)], dtype=torch.long, device=_device)
    with torch.no_grad():
        mel = _am.inference(ids)
        wav = _voc(mel).squeeze(0).cpu().numpy()
    buf = io.BytesIO()
    sf.write(buf, wav, req.sample_rate, format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")

def run(): import uvicorn; uvicorn.run(app, host="0.0.0.0", port=8001)
if __name__ == "__main__": run()
