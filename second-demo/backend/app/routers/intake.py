import asyncio
import hashlib
import uuid
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.confirm import FieldValidationError, resolve_field
from app.database import get_db
from app.models import ConfirmedProduct, IntakeItem, IntakeSource, IntakeStatus, OcrResult, is_valid_transition
from app.ocr import ocr_provider, preflight_status
from app.rate_limit import RateLimitExceeded, check_and_increment
from app.schemas import (
    ConfirmedProductOut,
    ConfirmIn,
    FieldGuessOut,
    IntakeItemOut,
    OcrLineOut,
    OcrPreflightOut,
    OcrResultOut,
    StatusUpdateIn,
)
from app.storage import create_signed_url, download_bytes, upload_bytes
from app.validation import (
    MIME_EXTENSIONS,
    UploadValidationError,
    make_thumbnail,
    read_upload_within_limit,
    validate_upload,
)

router = APIRouter()

# OCR is CPU-heavy and runs in the same thread pool as every other blocking
# call in this app (Supabase uploads/downloads) — without a cap here, a
# client could fire several concurrent large-image OCR requests (each still
# within the per-IP rate limit below) and stall unrelated requests like
# uploads or queue listing for everyone else on this single-process
# container. This limits how many OCR runs happen at once, app-wide.
_ocr_concurrency = asyncio.Semaphore(2)

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
    image = Image.open(BytesIO(content))

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
        image_hash=hashlib.sha256(content).hexdigest(),
        image_width=image.width,
        image_height=image.height,
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


def _ocr_result_to_out(record: OcrResult) -> OcrResultOut:
    return OcrResultOut(
        raw_text=record.raw_text,
        lines=[OcrLineOut(**line) for line in record.lines],
        title_guess=FieldGuessOut(value=record.title_guess, confidence=record.title_confidence, source="tesseract"),
        price_guess=FieldGuessOut(value=record.price_guess, confidence=record.price_confidence, source="tesseract"),
    )


@router.post("/intake-items/{item_id}/ocr/preflight", response_model=OcrPreflightOut)
async def ocr_preflight(request: Request, item_id: uuid.UUID, db: Session = Depends(get_db)):
    try:
        check_and_increment(db, f"ocr-preflight:{_client_ip(request)}", limit=60)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    item = db.get(IntakeItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")

    is_cached = item.image_hash is not None and db.get(OcrResult, item.image_hash) is not None
    status, reason = preflight_status(is_cached, item.image_width, item.image_height)
    return OcrPreflightOut(status=status, reason=reason)


@router.post("/intake-items/{item_id}/ocr/extract", response_model=OcrResultOut)
async def ocr_extract(request: Request, item_id: uuid.UUID, db: Session = Depends(get_db)):
    try:
        # OCR is CPU-heavy — a tighter limit than the other endpoints.
        check_and_increment(db, f"ocr:{_client_ip(request)}", limit=10)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many OCR requests — please wait a few minutes and try again.")

    item = db.get(IntakeItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")

    content: bytes | None = None
    if item.image_hash is None:
        content = await run_in_threadpool(download_bytes, item.storage_path)
        item.image_hash = hashlib.sha256(content).hexdigest()
        db.commit()

    cached = db.get(OcrResult, item.image_hash)
    if cached is not None:
        return _ocr_result_to_out(cached)

    if content is None:
        content = await run_in_threadpool(download_bytes, item.storage_path)

    async with _ocr_concurrency:
        result = await run_in_threadpool(ocr_provider.extract, content)

    record = OcrResult(
        image_hash=item.image_hash,
        raw_text=result.raw_text,
        lines=[{"text": line.text, "confidence": line.confidence} for line in result.lines],
        title_guess=result.title_guess.value,
        title_confidence=result.title_guess.confidence,
        price_guess=result.price_guess.value,
        price_confidence=result.price_guess.confidence,
    )
    try:
        db.add(record)
        db.commit()
    except IntegrityError:
        # Another request extracted the same image (same hash) first —
        # not a real error, just use what it already saved.
        db.rollback()
        record = db.get(OcrResult, item.image_hash)

    return _ocr_result_to_out(record)


@router.post("/intake-items/{item_id}/confirm", response_model=ConfirmedProductOut)
async def confirm_intake_item(request: Request, item_id: uuid.UUID, body: ConfirmIn, db: Session = Depends(get_db)):
    try:
        check_and_increment(db, f"confirm:{_client_ip(request)}")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    item = db.get(IntakeItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Not found.")

    if not is_valid_transition(item.status, IntakeStatus.CONFIRMED):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot confirm an item with status '{item.status.value}' — open it for review first.",
        )

    cached = db.get(OcrResult, item.image_hash) if item.image_hash else None

    try:
        name = resolve_field(body.product_name, body.product_name_override_reason, cached.title_guess if cached else None, "product name")
        price = resolve_field(body.price, body.price_override_reason, cached.price_guess if cached else None, "price")
    except FieldValidationError as err:
        raise HTTPException(status_code=400, detail=err.message)

    confirmed = ConfirmedProduct(
        intake_item_id=item.id,
        product_name=name.value,
        product_name_source=name.source,
        product_name_override_reason=name.override_reason,
        price=price.value,
        price_source=price.source,
        price_override_reason=price.override_reason,
        ocr_raw_text=cached.raw_text if cached else None,
        ocr_title_guess=cached.title_guess if cached else None,
        ocr_title_confidence=cached.title_confidence if cached else None,
        ocr_price_guess=cached.price_guess if cached else None,
        ocr_price_confidence=cached.price_confidence if cached else None,
    )
    db.add(confirmed)
    item.status = IntakeStatus.CONFIRMED
    try:
        db.commit()
    except IntegrityError:
        # Another request confirmed this exact item first (confirmed_products
        # has a unique constraint on intake_item_id) — same race the OCR
        # cache-write already handles above. Not data corruption, just two
        # requests racing for one outcome; report it as a clean conflict.
        db.rollback()
        raise HTTPException(status_code=409, detail="This item was already confirmed.")
    db.refresh(confirmed)

    return ConfirmedProductOut(
        id=confirmed.id,
        intake_item_id=confirmed.intake_item_id,
        product_name=confirmed.product_name,
        product_name_source=confirmed.product_name_source,
        product_name_override_reason=confirmed.product_name_override_reason,
        price=confirmed.price,
        price_source=confirmed.price_source,
        price_override_reason=confirmed.price_override_reason,
        confirmed_at=confirmed.confirmed_at,
    )
