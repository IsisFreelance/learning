import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.dialects.postgresql import ENUM, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class IntakeStatus(str, enum.Enum):
    NEW = "new"
    OPENED = "opened"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"
    ARCHIVED = "archived"
    DELETED = "deleted"


class IntakeSource(str, enum.Enum):
    CAMERA = "camera"
    UPLOAD = "upload"


# Which status changes are allowed, and from where. OPENED/CONFIRMED have no
# transitions yet because nothing sets them until Phase 3's review screen —
# Phase 1 only ever moves NEW -> {ARCHIVED, REJECTED, DELETED}, and restores
# any of those three straight back to NEW.
ALLOWED_STATUS_TRANSITIONS: dict[IntakeStatus, set[IntakeStatus]] = {
    IntakeStatus.NEW: {IntakeStatus.ARCHIVED, IntakeStatus.REJECTED, IntakeStatus.DELETED},
    IntakeStatus.ARCHIVED: {IntakeStatus.NEW},
    IntakeStatus.REJECTED: {IntakeStatus.NEW},
    IntakeStatus.DELETED: {IntakeStatus.NEW},
    IntakeStatus.OPENED: set(),
    IntakeStatus.CONFIRMED: set(),
}


def is_valid_transition(current: IntakeStatus, target: IntakeStatus) -> bool:
    return target in ALLOWED_STATUS_TRANSITIONS.get(current, set())


def _values(enum_cls):
    # SQLAlchemy's ENUM defaults to storing each member's *name* ("NEW"),
    # not its .value ("new") — fixing that here so the actual Postgres enum
    # values match the lowercase strings the API and the original brief use.
    return [member.value for member in enum_cls]


intake_status_enum = ENUM(IntakeStatus, name="intake_status", values_callable=_values)
intake_source_enum = ENUM(IntakeSource, name="intake_source", values_callable=_values)


class IntakeItem(Base):
    __tablename__ = "intake_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    status: Mapped[IntakeStatus] = mapped_column(intake_status_enum, nullable=False, default=IntakeStatus.NEW)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_path: Mapped[str] = mapped_column(String, nullable=False)
    thumbnail_path: Mapped[str] = mapped_column(String, nullable=False)
    source: Mapped[IntakeSource] = mapped_column(intake_source_enum, nullable=False)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Nullable because items uploaded before Phase 2 don't have these yet —
    # backfilled lazily the first time OCR is requested on an older item.
    # SHA-256 of the original file's bytes; used as the ocr_results cache
    # key so re-uploading the exact same photo never re-runs OCR.
    image_hash: Mapped[str | None] = mapped_column(String, nullable=True)
    image_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    image_height: Mapped[int | None] = mapped_column(Integer, nullable=True)


class RateLimitCounter(Base):
    __tablename__ = "rate_limit_counters"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class OcrResult(Base):
    __tablename__ = "ocr_results"

    # Keyed by image content, not by intake item — if the same photo is
    # ever uploaded twice, OCR only ever runs once.
    image_hash: Mapped[str] = mapped_column(String, primary_key=True)
    raw_text: Mapped[str] = mapped_column(String, nullable=False)
    lines: Mapped[list] = mapped_column(JSONB, nullable=False)
    title_guess: Mapped[str | None] = mapped_column(String, nullable=True)
    title_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    price_guess: Mapped[str | None] = mapped_column(String, nullable=True)
    price_confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
