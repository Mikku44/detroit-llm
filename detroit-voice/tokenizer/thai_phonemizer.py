import re
import unicodedata

_THAI_PUNCT = re.compile(r"[ๆฯๆ]")
_THAI_TONE_MARKS = set("่้๊๋")
_THAI_CONSONANTS = list("กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ")
_THAI_VOWELS = set("ะาิีึืุูเแโใไำ็ัํ")

PHONEME_VOCAB = [
    "<pad>", "<unk>", "<sos>", "<eos>", "<sil>",
    *sorted(set(_THAI_CONSONANTS)),
    *sorted(_THAI_VOWELS),
    *sorted(_THAI_TONE_MARKS),
    "ː", "ʔ", "ɯ", "ɤ", "ɔ", "ɛ",
]

PHONEME2ID = {p: i for i, p in enumerate(PHONEME_VOCAB)}
ID2PHONEME = {i: p for p, i in PHONEME2ID.items()}

_REPEAT = re.compile(r"(.)\1{2,}")
_WS = re.compile(r"\s+")

def normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text.strip())
    text = _WS.sub(" ", text)
    return text

def _rule_g2p(text: str) -> list[str]:
    out: list[str] = []
    for ch in text:
        if ch == " ":
            out.append("<sil>")
        elif ch in PHONEME2ID:
            out.append(ch)
        elif ch in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ":
            out.append(ch.lower())
        elif ch in ".,!?;:\"'()[]{}":
            out.append("<sil>")
    return out

class ThaiPhonemizer:
    def __init__(self, use_pythainlp: bool = True):
        self.use_pythainlp = use_pythainlp
        self._segmenter = None
        if use_pythainlp:
            try:
                from pythainlp.tokenize import word_tokenize
                self._segmenter = word_tokenize
            except ImportError:
                self._segmenter = None

    def segment(self, text: str) -> list[str]:
        if self._segmenter:
            return self._segmenter(text, engine="newmm")
        return text.split()

    def phonemize(self, text: str) -> list[str]:
        text = normalize(text)
        if not text:
            return []
        return _rule_g2p(text)

    def encode(self, text: str, add_bos_eos: bool = True) -> list[int]:
        ph = self.phonemize(text)
        ids = [PHONEME2ID.get(p, PHONEME2ID["<unk>"]) for p in ph]
        if add_bos_eos:
            ids = [PHONEME2ID["<sos>"]] + ids + [PHONEME2ID["<eos>"]]
        return ids

    def decode(self, ids: list[int]) -> str:
        return "".join(ID2PHONEME.get(i, "<unk>") for i in ids if i not in (PHONEME2ID["<pad>"], PHONEME2ID["<sos>"], PHONEME2ID["<eos>"]))

    @property
    def vocab_size(self) -> int:
        return len(PHONEME_VOCAB)
