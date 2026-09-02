# Detroit Voice — Thai TTS

FastSpeech2 + HiFi-GAN stack for Thai.

```
detroit-voice/
  tokenizer/thai_phonemizer.py  # Thai G2P + vocab
  models/text_encoder.py        # Transformer encoder
  models/duration_predictor.py  # Duration predictor
  models/acoustic_model.py      # FastSpeech2 acoustic model
  models/vocoder.py             # HiFi-GAN vocoder
  training/train.py             # Training loop
  server/api.py                 # FastAPI /synthesize
  inference/synthesize.py       # CLI TTS
```

## Setup
```bash
cd detroit-voice
pip install -r requirements.txt
```

## Train
```bash
python -m training.train --manifest dataset/manifest.json --epochs 100
```

## Synthesize
```bash
python -m inference.synthesize "สวัสดีครับ" --out output.wav
```

## Server
```bash
uvicorn server.api:app --port 8001 --reload
# POST /synthesize {"text":"สวัสดีครับ"} -> audio/wav
# GET  /phonemize?text=สวัสดี
# GET  /health
```
