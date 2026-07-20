import re
import string
from dataclasses import dataclass
from datetime import datetime
from difflib import SequenceMatcher
from uuid import UUID

# Punctuation is replaced with a space (not deleted outright) before
# whitespace is collapsed -- deleting "-" directly would turn
# "Widget-Pro-500" into "WidgetPro500", merging two separate words instead
# of just ignoring the punctuation between them.
_PUNCTUATION_TO_SPACE = str.maketrans(string.punctuation, " " * len(string.punctuation))

# How similar two *different* normalized names have to be to surface as a
# "possible duplicate" (e.g. an OCR misread) rather than being ignored as
# genuinely different products. 1.0 = identical (which would already be an
# exact-match group, not a "possible" one).
POSSIBLE_DUPLICATE_THRESHOLD = 0.85


@dataclass
class ProductRecord:
    id: UUID
    product_name: str | None
    product_name_source: str
    price: str | None
    price_source: str
    confirmed_at: datetime
    updated_at: datetime | None


@dataclass
class GroupResult:
    normalized_name: str
    status: str  # "ready" | "blocked"
    canonical_name: str | None
    members: list[ProductRecord]


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    despaced_punctuation = name.translate(_PUNCTUATION_TO_SPACE)
    return re.sub(r"\s+", " ", despaced_punctuation).strip().casefold()


def normalize_price(price: str | None) -> str:
    if not price:
        return ""
    return price.replace("$", "").strip()


def group_by_name(products: list[ProductRecord]) -> dict[str, list[ProductRecord]]:
    """Groups every product by its normalized name, including singletons --
    the caller decides whether a singleton counts as a "group" worth
    showing (it doesn't, for ready/blocked) or just a candidate for the
    possible-duplicates pass (it does)."""
    groups: dict[str, list[ProductRecord]] = {}
    for product in products:
        key = normalize_name(product.product_name)
        if not key:
            continue  # no name at all (override) -- nothing to group
        groups.setdefault(key, []).append(product)
    return groups


def classify_group(normalized_name: str, members: list[ProductRecord]) -> GroupResult:
    normalized_prices = {normalize_price(member.price) for member in members}
    is_ready = len(normalized_prices) <= 1

    canonical_name = None
    if is_ready:
        # "Most recently confirmed or edited spelling wins" -- an edit
        # (updated_at) is a more recent, more likely trustworthy correction
        # of the name than the original OCR/manual entry at confirm time.
        most_recent = max(members, key=lambda m: m.updated_at or m.confirmed_at)
        canonical_name = most_recent.product_name

    return GroupResult(
        normalized_name=normalized_name,
        status="ready" if is_ready else "blocked",
        canonical_name=canonical_name,
        members=members,
    )


def find_possible_duplicates(
    normalized_names: list[str], threshold: float = POSSIBLE_DUPLICATE_THRESHOLD
) -> list[tuple[str, str, float]]:
    """Pairwise-compares every distinct normalized name against every other
    one. Fine at this app's scale (low hundreds of products at most) --
    would need a smarter approach (blocking/indexing) if that ever grows
    by an order of magnitude or more."""
    pairs: list[tuple[str, str, float]] = []
    for i in range(len(normalized_names)):
        for j in range(i + 1, len(normalized_names)):
            a, b = normalized_names[i], normalized_names[j]
            similarity = SequenceMatcher(None, a, b).ratio()
            if similarity >= threshold:
                pairs.append((a, b, similarity))
    return pairs


@dataclass
class ComputedGrouping:
    ready_groups: list[GroupResult]
    blocked_groups: list[GroupResult]
    # (normalized_name_a, normalized_name_b, similarity, members_a, members_b)
    possible_duplicates: list[tuple[str, str, float, list[ProductRecord], list[ProductRecord]]]


def compute_grouping(products: list[ProductRecord]) -> ComputedGrouping:
    """The single shared computation both the live report (Phase 5) and
    saving a run (Phase 6) are built on, so there's exactly one place that
    decides what counts as a group/conflict/possible-duplicate."""
    normalized_groups = group_by_name(products)

    ready_groups: list[GroupResult] = []
    blocked_groups: list[GroupResult] = []
    for normalized_name, members in normalized_groups.items():
        if len(members) < 2:
            continue  # nothing to compare a lone product against
        result = classify_group(normalized_name, members)
        (ready_groups if result.status == "ready" else blocked_groups).append(result)

    possible_duplicates = [
        (key_a, key_b, similarity, normalized_groups[key_a], normalized_groups[key_b])
        for key_a, key_b, similarity in find_possible_duplicates(list(normalized_groups.keys()))
    ]

    return ComputedGrouping(ready_groups=ready_groups, blocked_groups=blocked_groups, possible_duplicates=possible_duplicates)


def _member_to_snapshot(member: ProductRecord) -> dict:
    return {
        "product_id": str(member.id),
        "product_name": member.product_name,
        "product_name_source": member.product_name_source,
        "price": member.price,
        "price_source": member.price_source,
        "confirmed_at": member.confirmed_at.isoformat(),
        "updated_at": member.updated_at.isoformat() if member.updated_at else None,
    }


def _group_to_snapshot(group: GroupResult) -> dict:
    return {
        "normalized_name": group.normalized_name,
        "status": group.status,
        "canonical_name": group.canonical_name,
        "members": [_member_to_snapshot(m) for m in group.members],
    }


def build_run_payload(grouping: ComputedGrouping) -> dict:
    """Converts a computed grouping into a plain JSON-safe dict for
    NormalizationRun.payload -- a true point-in-time snapshot of each
    member's name/price/source/timestamps, frozen even if the product is
    edited afterward. Deliberately excludes thumbnail URLs: Supabase's
    signed URLs (app/storage.py) expire after an hour, so a saved run
    re-signs a thumbnail from the current photo at view time instead of
    storing one that would eventually break."""
    return {
        "ready_groups": [_group_to_snapshot(g) for g in grouping.ready_groups],
        "blocked_groups": [_group_to_snapshot(g) for g in grouping.blocked_groups],
        "possible_duplicates": [
            {
                "similarity": round(similarity, 3),
                "group_a": {"normalized_name": key_a, "members": [_member_to_snapshot(m) for m in members_a]},
                "group_b": {"normalized_name": key_b, "members": [_member_to_snapshot(m) for m in members_b]},
            }
            for key_a, key_b, similarity, members_a, members_b in grouping.possible_duplicates
        ],
    }
