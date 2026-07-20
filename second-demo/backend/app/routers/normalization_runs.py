import asyncio
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_admin
from app.database import get_db
from app.models import ConfirmedProduct, IntakeItem, NormalizationRun
from app.normalization import build_run_payload, compute_grouping
from app.rate_limit import RateLimitExceeded, check_and_increment, client_ip
from app.routers.products import fetch_all_confirmed_records
from app.schemas import (
    NormalizationRunDetailOut,
    NormalizationRunGroupOut,
    NormalizationRunMemberOut,
    NormalizationRunPossibleDuplicateOut,
    NormalizationRunSummaryOut,
)
from app.spreadsheet import build_spreadsheet_response, escape_for_spreadsheet
from app.storage import create_signed_url

# Mounted at its own top-level prefix, deliberately not nested under
# /confirmed-products -- avoids any route-ordering conflict with that
# router's /confirmed-products/{product_id} catch-all entirely.
router = APIRouter(prefix="/normalization-runs", dependencies=[Depends(require_admin)])

_RUN_EXPORT_HEADERS = ["Status", "Product name", "Price", "Name source", "Price source", "Confirmed at", "Updated at"]


def _collect_product_ids(payload: dict) -> set[UUID]:
    ids: set[UUID] = set()
    for group in payload["ready_groups"] + payload["blocked_groups"]:
        for member in group["members"]:
            ids.add(UUID(member["product_id"]))
    for duplicate in payload["possible_duplicates"]:
        for member in duplicate["group_a"]["members"] + duplicate["group_b"]["members"]:
            ids.add(UUID(member["product_id"]))
    return ids


def _fetch_items_for_products(db: Session, product_ids: set[UUID]) -> dict[UUID, IntakeItem]:
    if not product_ids:
        return {}
    rows = db.execute(
        select(ConfirmedProduct.id, IntakeItem)
        .join(IntakeItem, ConfirmedProduct.intake_item_id == IntakeItem.id)
        .where(ConfirmedProduct.id.in_(product_ids))
    ).all()
    return dict(rows)


async def _sign_thumbnails(item_by_product_id: dict[UUID, IntakeItem]) -> dict[UUID, str]:
    product_ids = list(item_by_product_id.keys())
    urls = await asyncio.gather(*(run_in_threadpool(create_signed_url, item_by_product_id[pid].thumbnail_path) for pid in product_ids))
    return dict(zip(product_ids, urls))


def _member_out(member: dict, thumbnail_by_product_id: dict[UUID, str]) -> NormalizationRunMemberOut:
    product_id = UUID(member["product_id"])
    return NormalizationRunMemberOut(
        product_id=product_id,
        product_name=member["product_name"],
        product_name_source=member["product_name_source"],
        price=member["price"],
        price_source=member["price_source"],
        confirmed_at=datetime.fromisoformat(member["confirmed_at"]),
        updated_at=datetime.fromisoformat(member["updated_at"]) if member["updated_at"] else None,
        # None here means the product behind this snapshot entry was
        # deleted after the run was saved -- everything else in the
        # snapshot is still valid, there's just no current photo to sign.
        thumbnail_url=thumbnail_by_product_id.get(product_id),
    )


def _group_out(group: dict, thumbnail_by_product_id: dict[UUID, str]) -> NormalizationRunGroupOut:
    return NormalizationRunGroupOut(
        normalized_name=group["normalized_name"],
        status=group["status"],
        canonical_name=group["canonical_name"],
        members=[_member_out(m, thumbnail_by_product_id) for m in group["members"]],
    )


async def _build_run_detail(db: Session, run: NormalizationRun) -> NormalizationRunDetailOut:
    product_ids = _collect_product_ids(run.payload)
    item_by_product_id = _fetch_items_for_products(db, product_ids)
    thumbnail_by_product_id = await _sign_thumbnails(item_by_product_id)

    ready_groups = [_group_out(g, thumbnail_by_product_id) for g in run.payload["ready_groups"]]
    blocked_groups = [_group_out(g, thumbnail_by_product_id) for g in run.payload["blocked_groups"]]
    possible_duplicates = [
        NormalizationRunPossibleDuplicateOut(
            similarity=duplicate["similarity"],
            group_a=[_member_out(m, thumbnail_by_product_id) for m in duplicate["group_a"]["members"]],
            group_b=[_member_out(m, thumbnail_by_product_id) for m in duplicate["group_b"]["members"]],
        )
        for duplicate in run.payload["possible_duplicates"]
    ]

    return NormalizationRunDetailOut(
        id=run.id,
        created_at=run.created_at,
        ready_count=run.ready_count,
        blocked_count=run.blocked_count,
        possible_duplicate_count=run.possible_duplicate_count,
        ready_groups=ready_groups,
        blocked_groups=blocked_groups,
        possible_duplicates=possible_duplicates,
    )


@router.post("", response_model=NormalizationRunDetailOut)
async def save_normalization_run(request: Request, db: Session = Depends(get_db)):
    try:
        # A deliberate staff action (button click, not a page-load side
        # effect), but still a write -- same default limit as the other
        # write endpoints in this app.
        check_and_increment(db, f"normalization-run-save:{client_ip(request)}")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    _row_by_id, records = fetch_all_confirmed_records(db)
    grouping = compute_grouping(records)
    payload = build_run_payload(grouping)

    run = NormalizationRun(
        ready_count=len(grouping.ready_groups),
        blocked_count=len(grouping.blocked_groups),
        possible_duplicate_count=len(grouping.possible_duplicates),
        payload=payload,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    return await _build_run_detail(db, run)


@router.get("", response_model=list[NormalizationRunSummaryOut])
async def list_normalization_runs(
    request: Request,
    limit: int = Query(default=50, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    try:
        check_and_increment(db, f"normalization-run-list:{client_ip(request)}", limit=60)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    stmt = select(NormalizationRun).order_by(NormalizationRun.created_at.desc()).limit(limit).offset(offset)
    runs = db.execute(stmt).scalars().all()
    return [
        NormalizationRunSummaryOut(
            id=run.id,
            created_at=run.created_at,
            ready_count=run.ready_count,
            blocked_count=run.blocked_count,
            possible_duplicate_count=run.possible_duplicate_count,
        )
        for run in runs
    ]


@router.get("/{run_id}", response_model=NormalizationRunDetailOut)
async def get_normalization_run(request: Request, run_id: UUID, db: Session = Depends(get_db)):
    try:
        check_and_increment(db, f"normalization-run-detail:{client_ip(request)}", limit=60)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    run = db.get(NormalizationRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Not found.")

    return await _build_run_detail(db, run)


@router.get("/{run_id}/export")
def export_normalization_run(request: Request, run_id: UUID, format: str = Query(default="csv"), db: Session = Depends(get_db)):
    if format not in ("csv", "xlsx"):
        raise HTTPException(status_code=400, detail="Format must be 'csv' or 'xlsx'.")

    try:
        check_and_increment(db, f"normalization-run-export:{client_ip(request)}", limit=10)
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many requests — please wait a few minutes and try again.")

    run = db.get(NormalizationRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Not found.")

    rows = []
    for group in run.payload["ready_groups"] + run.payload["blocked_groups"]:
        for member in group["members"]:
            rows.append(_export_row(group["status"], member))
    for duplicate in run.payload["possible_duplicates"]:
        for member in duplicate["group_a"]["members"] + duplicate["group_b"]["members"]:
            rows.append(_export_row("possible_duplicate", member))

    filename_base = f"normalization_run_{run.created_at.date().isoformat()}"
    return build_spreadsheet_response(format, _RUN_EXPORT_HEADERS, rows, filename_base, "Normalization run")


def _export_row(status: str, member: dict) -> list[str]:
    return [
        status,
        escape_for_spreadsheet(member["product_name"] or ""),
        escape_for_spreadsheet(member["price"] or ""),
        member["product_name_source"],
        member["price_source"],
        member["confirmed_at"],
        member["updated_at"] or "",
    ]
