import re
from dataclasses import dataclass
from io import BytesIO

import pytesseract
from PIL import Image

from app.config import settings

if settings.tesseract_cmd:
    # Windows doesn't put Tesseract on PATH by default, and fighting a
    # system PATH edit isn't worth it (see the Postgres service saga in
    # Phase 0) — point pytesseract at the exact binary via an env var
    # instead. Unset in production; the Docker image installs tesseract
    # onto PATH directly, so pytesseract finds it without any of this.
    pytesseract.pytesseract.tesseract_cmd = settings.tesseract_cmd

# Below this, OCR is unreliable enough that running it is a waste of a
# rate-limited request — roughly a 200x200 photo.
MIN_OCR_PIXELS = 40_000

PRICE_PATTERN = re.compile(r"\$\s?\d{1,4}(?:[.,]\d{2})?|\d{1,4}[.,]\d{2}\b")


@dataclass
class OcrLine:
    text: str
    confidence: float


@dataclass
class FieldGuess:
    value: str | None
    confidence: float
    source: str = "tesseract"


@dataclass
class OcrResult:
    raw_text: str
    lines: list[OcrLine]
    title_guess: FieldGuess
    price_guess: FieldGuess


class OcrProvider:
    """Interface any OCR engine can implement — swap TesseractProvider for a
    paid provider later without touching the routes that call it."""

    def extract(self, image_bytes: bytes) -> OcrResult:
        raise NotImplementedError


def _lines_from_tesseract_data(data: dict) -> list[OcrLine]:
    # image_to_data returns one entry per *word*, with the line it belongs
    # to identified by (block_num, par_num, line_num) — group words back
    # into lines and average their confidence. conf is -1 for non-text
    # regions Tesseract detected but didn't attempt to read.
    grouped: dict[tuple[int, int, int], list[tuple[str, int]]] = {}
    for i in range(len(data["text"])):
        text = data["text"][i].strip()
        conf = int(data["conf"][i])
        if not text or conf < 0:
            continue
        key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
        grouped.setdefault(key, []).append((text, conf))

    lines = []
    for words in grouped.values():
        text = " ".join(word for word, _ in words)
        confidence = sum(conf for _, conf in words) / len(words)
        lines.append(OcrLine(text=text, confidence=round(confidence, 1)))
    return lines


def preflight_status(is_cached: bool, width: int | None, height: int | None) -> tuple[str, str | None]:
    """Pure decision logic behind the preflight endpoint, kept separate
    from the DB lookups so it's directly testable — mirrors how
    is_valid_transition() in models.py is tested apart from its endpoint.
    width/height are None for items uploaded before Phase 2; the
    resolution check is skipped rather than guessed for those."""
    if is_cached:
        return "cached", None
    if width is not None and height is not None and width * height < MIN_OCR_PIXELS:
        return "blocked", "Image resolution is too low for reliable text extraction."
    return "available", None


def guess_price(lines: list[OcrLine]) -> FieldGuess:
    for line in lines:
        if PRICE_PATTERN.search(line.text):
            return FieldGuess(value=line.text, confidence=line.confidence)
    return FieldGuess(value=None, confidence=0.0)


def guess_title(lines: list[OcrLine], price_line_text: str | None) -> FieldGuess:
    # Best-effort only: the clearest (highest-confidence) line of text
    # that isn't the price. No real understanding of "this is a product
    # name" — a human confirms or corrects this in Phase 3's review step.
    candidates = [line for line in lines if line.text != price_line_text and len(line.text) > 2]
    if not candidates:
        return FieldGuess(value=None, confidence=0.0)
    best = max(candidates, key=lambda line: line.confidence)
    return FieldGuess(value=best.text, confidence=best.confidence)


class TesseractProvider(OcrProvider):
    def extract(self, image_bytes: bytes) -> OcrResult:
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
        data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
        lines = _lines_from_tesseract_data(data)
        raw_text = "\n".join(line.text for line in lines)
        price_guess = guess_price(lines)
        title_guess = guess_title(lines, price_guess.value)
        return OcrResult(raw_text=raw_text, lines=lines, title_guess=title_guess, price_guess=price_guess)


ocr_provider: OcrProvider = TesseractProvider()
