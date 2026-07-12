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
