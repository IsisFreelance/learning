import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import ENUM, UUID
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


class RateLimitCounter(Base):
    __tablename__ = "rate_limit_counters"

    key: Mapped[str] = mapped_column(String, primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
