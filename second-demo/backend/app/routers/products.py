import asyncio
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import asc, desc, or_, select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.confirm import FieldValidationError, resolve_field
from app.database import get_db
from app.models import ConfirmedProduct, IntakeItem
from app.normalization import ProductRecord, compute_grouping
from app.rate_limit import RateLimitExceeded, check_and_increment, client_ip
from app.schemas import (
    ConfirmedProductDetailOut,
    ConfirmedProductListItemOut,
    ConfirmedProductPatchIn,
    PossibleDuplicateOut,
    ProductGroupingOut,
    ProductGroupOut,
)
from app.spreadsheet import build_spreadsheet_response, escape_for_spreadsheet
from app.storage import create_signed_url

router = APIRouter(prefix="/confirmed-products", dependencies=[Depends(require_admin)])

_SORT_COLUMNS = {
    "name": ConfirmedProduct.product_name,
    "price": ConfirmedProduct.price,
    "confirmed_at": ConfirmedProduct.confirmed_at,
}


def _apply_filters(stmt, q: str | None, source: str | None):
    if q:
        stmt = stmt.where(ConfirmedProduct.product_name.ilike(f"%{q}%"))
    if source:
        # A row tracks a source per field (name vs. price), not one overall
        # source -- "filter by source" means "show me rows where *either*
        # field came from this source."
        stmt = stmt.where(or_(ConfirmedProduct.product_name_source == source, ConfirmedProduct.price_source == source))
    return stmt


def _build_sorted_query(q: str | None, source: str | None, sort: str, order: str):
    if sort not in _SORT_COLUMNS:
        raise HTTPException(status_code=400, detail=f"Invalid sort field '{sort}'.")
    if order not in ("asc", "desc"):
        raise HTTPException(status_code=400, detail="Order must be 'asc' or 'desc'.")

    direction = asc if order == "asc" else desc
    stmt = select(ConfirmedProduct, IntakeItem).join(IntakeItem, ConfirmedProduct.intake_item_id == IntakeItem.id)
    stmt = _apply_filters(stmt, q, source)
    return stmt.order_by(direction(_SORT_COLUMNS[sort]), ConfirmedProduct.id)


async def _to_list_item(product: ConfirmedProduct, item: IntakeItem) -> ConfirmedProductListItemOut:
    thumbnail_url = await run_in_threadpool(create_signed_url, item.thumbnail_path)
    return ConfirmedProductListItemOut(
        id=product.id,
        intake_item_id=product.intake_item_id,
        product_name=product.product_name,
        product_name_source=product.product_name_source,
        price=product.price,
        price_source=product.price_source,
        thumbnail_url=thumbnail_url,
        confirmed_at=product.confirmed_at,
        updated_at=product.updated_at,
    )


@router.get("", response_model=list[ConfirmedProductListItemOut])
async def list_confirmed_products(
    request: Request,
    q: str | None = Query(default=None, max_length=300),
    source: str | None = Query(default=None),
    sort: str = Query(default="confirmed_at"),
    order: str = Query(default="desc"),
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    try:
        # Same reasoning as list_intake_items: a read, but each row still
        # costs a real Supabase API call to sign its thumbnail URL.
        check_and_increment(db, f"products-list:{client_ip(request)}", limit=60)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    stmt = _build_sorted_query(q, source, sort, order).limit(limit).offset(offset)
    rows = db.execute(stmt).all()
    return await asyncio.gather(*(_to_list_item(product, item) for product, item in rows))


_EXPORT_HEADERS = ["Product name", "Price", "Name source", "Price source", "Confirmed at", "Updated at"]


def _export_rows(db: Session, q: str | None, source: str | None, sort: str, order: str):
    stmt = _build_sorted_query(q, source, sort, order)
    for product, _item in db.execute(stmt).all():
        yield [
            escape_for_spreadsheet(product.product_name or ""),
            escape_for_spreadsheet(product.price or ""),
            product.product_name_source,
            product.price_source,
            product.confirmed_at.isoformat(),
            product.updated_at.isoformat() if product.updated_at else "",
        ]


@router.get("/export")
def export_confirmed_products(
    request: Request,
    format: str = Query(default="csv"),
    q: str | None = Query(default=None, max_length=300),
    source: str | None = Query(default=None),
    sort: str = Query(default="confirmed_at"),
    order: str = Query(default="desc"),
    db: Session = Depends(get_db),
):
    if format not in ("csv", "xlsx"):
        raise HTTPException(status_code=400, detail="Format must be 'csv' or 'xlsx'.")

    try:
        # Tighter than the list/detail reads -- generating a full export is
        # a heavier, more deliberate action than browsing a page at a time.
        check_and_increment(db, f"products-export:{client_ip(request)}", limit=10)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    rows = list(_export_rows(db, q, source, sort, order))
    return build_spreadsheet_response(format, _EXPORT_HEADERS, rows, "confirmed_products", "Confirmed products")


def fetch_all_confirmed_records(
    db: Session,
) -> tuple[dict[UUID, tuple[ConfirmedProduct, IntakeItem]], list[ProductRecord]]:
    """Shared by the live /groups report and Phase 6's saved runs -- one
    place that decides how a ConfirmedProduct+IntakeItem row becomes a
    normalization.ProductRecord."""
    rows = db.execute(select(ConfirmedProduct, IntakeItem).join(IntakeItem, ConfirmedProduct.intake_item_id == IntakeItem.id)).all()
    row_by_id = {product.id: (product, item) for product, item in rows}
    records = [
        ProductRecord(
            id=product.id,
            product_name=product.product_name,
            product_name_source=product.product_name_source,
            price=product.price,
            price_source=product.price_source,
            confirmed_at=product.confirmed_at,
            updated_at=product.updated_at,
        )
        for product, _item in rows
    ]
    return row_by_id, records


async def members_out(
    row_by_id: dict[UUID, tuple[ConfirmedProduct, IntakeItem]], members: list[ProductRecord]
) -> list[ConfirmedProductListItemOut]:
    return await asyncio.gather(*(_to_list_item(*row_by_id[member.id]) for member in members))


@router.get("/groups", response_model=ProductGroupingOut)
async def get_confirmed_product_groups(request: Request, db: Session = Depends(get_db)):
    try:
        # Computing this touches every confirmed product and signs a
        # thumbnail for each one shown -- a heavier read than a single
        # paginated list page, so a tighter cap than list/detail.
        check_and_increment(db, f"products-groups:{client_ip(request)}", limit=20)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    row_by_id, records = fetch_all_confirmed_records(db)
    grouping = compute_grouping(records)

    async def _group_out(group) -> ProductGroupOut:
        return ProductGroupOut(
            normalized_name=group.normalized_name,
            status=group.status,
            canonical_name=group.canonical_name,
            members=await members_out(row_by_id, group.members),
        )

    ready_groups = [await _group_out(g) for g in grouping.ready_groups]
    blocked_groups = [await _group_out(g) for g in grouping.blocked_groups]
    possible_duplicates = [
        PossibleDuplicateOut(
            similarity=round(similarity, 3),
            group_a=await members_out(row_by_id, members_a),
            group_b=await members_out(row_by_id, members_b),
        )
        for _key_a, _key_b, similarity, members_a, members_b in grouping.possible_duplicates
    ]

    return ProductGroupingOut(ready_groups=ready_groups, blocked_groups=blocked_groups, possible_duplicates=possible_duplicates)


def _get_product_and_item(db: Session, product_id: UUID) -> tuple[ConfirmedProduct, IntakeItem]:
    row = db.execute(
        select(ConfirmedProduct, IntakeItem)
        .join(IntakeItem, ConfirmedProduct.intake_item_id == IntakeItem.id)
        .where(ConfirmedProduct.id == product_id)
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not found.")
    return row


async def _to_detail(product: ConfirmedProduct, item: IntakeItem) -> ConfirmedProductDetailOut:
    image_url, thumbnail_url = await asyncio.gather(
        run_in_threadpool(create_signed_url, item.storage_path),
        run_in_threadpool(create_signed_url, item.thumbnail_path),
    )
    return ConfirmedProductDetailOut(
        id=product.id,
        intake_item_id=product.intake_item_id,
        product_name=product.product_name,
        product_name_source=product.product_name_source,
        product_name_override_reason=product.product_name_override_reason,
        price=product.price,
        price_source=product.price_source,
        price_override_reason=product.price_override_reason,
        ocr_raw_text=product.ocr_raw_text,
        ocr_title_guess=product.ocr_title_guess,
        ocr_title_confidence=product.ocr_title_confidence,
        ocr_price_guess=product.ocr_price_guess,
        ocr_price_confidence=product.ocr_price_confidence,
        confirmed_at=product.confirmed_at,
        updated_at=product.updated_at,
        image_url=image_url,
        thumbnail_url=thumbnail_url,
    )


@router.get("/{product_id}", response_model=ConfirmedProductDetailOut)
async def get_confirmed_product(request: Request, product_id: UUID, db: Session = Depends(get_db)):
    try:
        check_and_increment(db, f"products-detail:{client_ip(request)}", limit=60)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    product, item = _get_product_and_item(db, product_id)
    return await _to_detail(product, item)


@router.patch("/{product_id}", response_model=ConfirmedProductDetailOut)
async def update_confirmed_product(
    request: Request, product_id: UUID, body: ConfirmedProductPatchIn, db: Session = Depends(get_db)
):
    try:
        check_and_increment(db, f"products-update:{client_ip(request)}")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    product, item = _get_product_and_item(db, product_id)

    try:
        # Same source-tagging logic Phase 3 established for the original
        # confirm step -- compared against the OCR snapshot already stored
        # on this row, not a fresh OCR lookup.
        name = resolve_field(body.product_name, body.product_name_override_reason, product.ocr_title_guess, "product name")
        price = resolve_field(body.price, body.price_override_reason, product.ocr_price_guess, "price")
    except FieldValidationError as err:
        raise HTTPException(status_code=400, detail=err.message)

    product.product_name = name.value
    product.product_name_source = name.source
    product.product_name_override_reason = name.override_reason
    product.price = price.value
    product.price_source = price.source
    product.price_override_reason = price.override_reason
    product.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(product)

    return await _to_detail(product, item)


@router.delete("/{product_id}", status_code=204)
async def delete_confirmed_product(request: Request, product_id: UUID, db: Session = Depends(get_db)):
    try:
        check_and_increment(db, f"products-delete:{client_ip(request)}")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    product = db.get(ConfirmedProduct, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Not found.")

    # Only removes this row -- the linked intake_item stays CONFIRMED
    # (already documented as terminal in app/models.py) and simply drops
    # out of this table.
    db.delete(product)
    db.commit()
