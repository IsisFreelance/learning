from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

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


class ConfirmIn(BaseModel):
    product_name: str | None = Field(default=None, max_length=300)
    product_name_override_reason: str | None = Field(default=None, max_length=500)
    price: str | None = Field(default=None, max_length=50)
    price_override_reason: str | None = Field(default=None, max_length=500)


class ConfirmedProductOut(BaseModel):
    id: UUID
    intake_item_id: UUID
    product_name: str | None
    product_name_source: str
    product_name_override_reason: str | None
    price: str | None
    price_source: str
    price_override_reason: str | None
    confirmed_at: datetime
