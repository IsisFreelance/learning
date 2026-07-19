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


class LoginIn(BaseModel):
    password: str = Field(max_length=200)


class LoginOut(BaseModel):
    token: str


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


class ConfirmedProductPatchIn(BaseModel):
    product_name: str | None = Field(default=None, max_length=300)
    product_name_override_reason: str | None = Field(default=None, max_length=500)
    price: str | None = Field(default=None, max_length=50)
    price_override_reason: str | None = Field(default=None, max_length=500)


class ConfirmedProductListItemOut(BaseModel):
    id: UUID
    intake_item_id: UUID
    product_name: str | None
    product_name_source: str
    price: str | None
    price_source: str
    thumbnail_url: str
    confirmed_at: datetime
    updated_at: datetime | None


class ProductGroupOut(BaseModel):
    normalized_name: str
    status: str  # "ready" | "blocked"
    canonical_name: str | None
    members: list[ConfirmedProductListItemOut]


class PossibleDuplicateOut(BaseModel):
    similarity: float
    group_a: list[ConfirmedProductListItemOut]
    group_b: list[ConfirmedProductListItemOut]


class ProductGroupingOut(BaseModel):
    ready_groups: list[ProductGroupOut]
    blocked_groups: list[ProductGroupOut]
    possible_duplicates: list[PossibleDuplicateOut]


class ConfirmedProductDetailOut(BaseModel):
    id: UUID
    intake_item_id: UUID
    product_name: str | None
    product_name_source: str
    product_name_override_reason: str | None
    price: str | None
    price_source: str
    price_override_reason: str | None
    ocr_raw_text: str | None
    ocr_title_guess: str | None
    ocr_title_confidence: float | None
    ocr_price_guess: str | None
    ocr_price_confidence: float | None
    confirmed_at: datetime
    updated_at: datetime | None
    image_url: str
    thumbnail_url: str
