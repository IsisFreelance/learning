from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.models import IntakeSource, IntakeStatus


class IntakeItemOut(BaseModel):
    id: UUID
    status: IntakeStatus
    original_filename: str
    mime_type: str
    file_size_bytes: int
    source: IntakeSource
    uploaded_at: datetime
    image_url: str
    thumbnail_url: str


class StatusUpdateIn(BaseModel):
    status: IntakeStatus


class OcrPreflightOut(BaseModel):
    status: str  # "cached" | "available" | "blocked"
    reason: str | None = None


class OcrLineOut(BaseModel):
    text: str
    confidence: float


class FieldGuessOut(BaseModel):
    value: str | None
    confidence: float
    source: str


class OcrResultOut(BaseModel):
    raw_text: str
    lines: list[OcrLineOut]
    title_guess: FieldGuessOut
    price_guess: FieldGuessOut
