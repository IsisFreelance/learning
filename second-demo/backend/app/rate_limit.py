from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.orm import Session

WINDOW_SECONDS = 300  # 5 minutes
MAX_REQUESTS_PER_WINDOW = 15


class RateLimitExceeded(Exception):
    pass


def client_ip(request: Request) -> str:
    # Render sits in front of the app as a single trusted proxy hop, which
    # *appends* the real peer IP to the end of x-forwarded-for -- the first
    # entry is whatever the client itself sent and is fully attacker
    # controlled, so only the last entry can be trusted here. This still
    # assumes the app is never reachable except through that proxy; see
    # the "Known issues" note in ROADMAP.md.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"


def check_and_increment(db: Session, key: str, limit: int = MAX_REQUESTS_PER_WINDOW) -> None:
    # A single atomic UPSERT — either starts a fresh window (past window
    # expired, or first request ever for this key) or increments the
    # existing one, all in one statement so concurrent requests can't race
    # each other into under-counting.
    now = datetime.now(timezone.utc)
    window_cutoff = now - timedelta(seconds=WINDOW_SECONDS)

    result = db.execute(
        text(
            """
            INSERT INTO rate_limit_counters (key, window_start, count)
            VALUES (:key, :now, 1)
            ON CONFLICT (key) DO UPDATE SET
                count = CASE
                    WHEN rate_limit_counters.window_start < :window_cutoff THEN 1
                    ELSE rate_limit_counters.count + 1
                END,
                window_start = CASE
                    WHEN rate_limit_counters.window_start < :window_cutoff THEN :now
                    ELSE rate_limit_counters.window_start
                END
            RETURNING count
            """
        ),
        {"key": key, "now": now, "window_cutoff": window_cutoff},
    )
    count = result.scalar_one()
    db.commit()

    if count > limit:
        raise RateLimitExceeded()
