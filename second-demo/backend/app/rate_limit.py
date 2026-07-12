from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

WINDOW_SECONDS = 300  # 5 minutes
MAX_REQUESTS_PER_WINDOW = 15


class RateLimitExceeded(Exception):
    pass


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
