import asyncio
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import IntakeItem, IntakeSource, IntakeStatus, is_valid_transition
from app.rate_limit import RateLimitExceeded, check_and_increment
from app.schemas import IntakeItemOut, StatusUpdateIn
from app.storage import create_signed_url, upload_bytes
from app.validation import (
    MIME_EXTENSIONS,
    UploadValidationError,
    make_thumbnail,
    read_upload_within_limit,
    validate_upload,
)

router = APIRouter()

# The Supabase SDK's storage client makes blocking HTTP calls under the
# hood. Calling it directly from an `async def` handler would run that
# blocking call *on the event loop itself*, freezing every other in-flight
# request (uploads, lists, status changes) for as long as the call takes —
# run_in_threadpool pushes it onto a worker thread instead, same mechanism
# Starlette already uses automatically for plain `def` route handlers.


def _client_ip(request: Request) -> str:
    # Render sits in front of the app as a single trusted proxy hop, which
    # *appends* the real peer IP to the end of x-forwarded-for — the first
    # entry is whatever the client itself sent and is fully attacker
    # controlled, so only the last entry can be trusted here. This still
    # assumes the app is never reachable except through that proxy; see
    # the "Known issues" note in ROADMAP.md.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


async def _to_out(item: IntakeItem) -> IntakeItemOut:
    image_url, thumbnail_url = await asyncio.gather(
        run_in_threadpool(create_signed_url, item.storage_path),
        run_in_threadpool(create_signed_url, item.thumbnail_path),
    )
    return IntakeItemOut(
        id=item.id,
        status=item.status,
        original_filename=item.original_filename,
        mime_type=item.mime_type,
        file_size_bytes=item.file_size_bytes,
        source=item.source,
        uploaded_at=item.uploaded_at,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
    )


@router.post("/intake-items", response_model=IntakeItemOut)
async def create_intake_item(
    request: Request,
    file: UploadFile = File(...),
    source: IntakeSource = Form(...),
    db: Session = Depends(get_db),
):
    try:
        check_and_increment(db, f"upload:{_client_ip(request)}")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many uploads — please wait a few minutes and try again.")

    declared_mime_type = file.content_type or "application/octet-stream"

    try:
        content = await read_upload_within_limit(file)
        validate_upload(content, declared_mime_type)
    except UploadValidationError as err:
        raise HTTPException(status_code=400, detail=err.message)

    thumbnail_bytes = make_thumbnail(content)

    item_id = uuid.uuid4()
    storage_path = f"{item_id}/original.{MIME_EXTENSIONS[declared_mime_type]}"
    thumbnail_path = f"{item_id}/thumbnail.jpg"

    await asyncio.gather(
        run_in_threadpool(upload_bytes, storage_path, content, declared_mime_type),
        run_in_threadpool(upload_bytes, thumbnail_path, thumbnail_bytes, "image/jpeg"),
    )

    item = IntakeItem(
        id=item_id,
        status=IntakeStatus.NEW,
        original_filename=file.filename or "unnamed",
        mime_type=declared_mime_type,
        file_size_bytes=len(content),
        storage_path=storage_path,
        thumbnail_path=thumbnail_path,
        source=source,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    return await _to_out(item)


@router.get("/intake-items", response_model=list[IntakeItemOut])
async def list_intake_items(
    request: Request,
    status: IntakeStatus | None = Query(default=None),
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    try:
        # A higher ceiling than the write endpoints — this is a read, but
        # each item still costs two real Supabase API calls to sign, so an
        # unthrottled scripted loop here is a genuine way to hammer both
        # this service and Supabase's own API.
        check_and_increment(db, f"list:{_client_ip(request)}", limit=60)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    stmt = select(IntakeItem).order_by(IntakeItem.uploaded_at.desc()).limit(limit).offset(offset)
    if status is not None:
        stmt = stmt.where(IntakeItem.status == status)
    items = db.execute(stmt).scalars().all()
    return await asyncio.gather(*(_to_out(item) for item in items))


@router.patch("/intake-items/{item_id}/status", response_model=IntakeItemOut)
async def update_intake_item_status(
    request: Request,
    item_id: uuid.UUID,
    body: StatusUpdateIn,
    db: Session = Depends(get_db),
):
    try:
        check_and_increment(db, f"status-update:{_client_ip(request)}")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    item = db.get(IntakeItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")

    if not is_valid_transition(item.status, body.status):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot change status from '{item.status.value}' to '{body.status.value}'.",
        )

    item.status = body.status
    db.commit()
    db.refresh(item)
    return await _to_out(item)
