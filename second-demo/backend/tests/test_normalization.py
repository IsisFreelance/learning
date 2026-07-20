import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.normalization import (
    ProductRecord,
    build_run_payload,
    classify_group,
    compute_grouping,
    find_possible_duplicates,
    group_by_name,
    normalize_name,
    normalize_price,
)

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def make_product(name, price, confirmed_at=NOW, updated_at=None, product_name_source="manual", price_source="manual"):
    return ProductRecord(
        id=uuid4(),
        product_name=name,
        product_name_source=product_name_source,
        price=price,
        price_source=price_source,
        confirmed_at=confirmed_at,
        updated_at=updated_at,
    )


def test_normalize_name_collapses_whitespace_and_case():
    assert normalize_name("  WIDGET   Pro 500 ") == "widget pro 500"


def test_normalize_name_treats_punctuation_as_a_separator_not_deleted():
    # Deleting "-" outright would merge "Widget-Pro-500" into "widgetpro500",
    # wrongly matching a name that never had a hyphen at all.
    assert normalize_name("Widget-Pro-500") == "widget pro 500"


def test_normalize_name_empty_or_none_is_empty_string():
    assert normalize_name(None) == ""
    assert normalize_name("   ") == ""


def test_normalize_price_strips_dollar_sign_and_whitespace():
    assert normalize_price(" $24.99 ") == "24.99"
    assert normalize_price("24.99") == "24.99"


def test_normalize_price_empty_or_none_is_empty_string():
    assert normalize_price(None) == ""


def test_group_by_name_groups_matching_normalized_names_together():
    a = make_product("Widget Pro 500", "19.99")
    b = make_product("WIDGET  PRO 500", "19.99")
    c = make_product("Something Else", "5.00")
    groups = group_by_name([a, b, c])
    assert groups["widget pro 500"] == [a, b]
    assert groups["something else"] == [c]


def test_group_by_name_skips_products_with_no_name():
    only_override = make_product(None, None)
    groups = group_by_name([only_override])
    assert groups == {}


def test_classify_group_same_price_is_ready():
    a = make_product("Widget Pro 500", "19.99")
    b = make_product("WIDGET PRO 500", "$19.99")
    result = classify_group("widget pro 500", [a, b])
    assert result.status == "ready"
    assert result.canonical_name is not None


def test_classify_group_different_price_is_blocked():
    a = make_product("Widget Pro 500", "19.99")
    b = make_product("Widget Pro 500", "24.99")
    result = classify_group("widget pro 500", [a, b])
    assert result.status == "blocked"
    assert result.canonical_name is None


def test_classify_group_canonical_name_prefers_most_recently_updated():
    older = make_product("widget pro 500", "19.99", confirmed_at=NOW)
    newer_edit = make_product("Widget Pro 500 (Blue)", "19.99", confirmed_at=NOW, updated_at=NOW + timedelta(days=1))
    result = classify_group("widget pro 500", [older, newer_edit])
    assert result.canonical_name == "Widget Pro 500 (Blue)"


def test_classify_group_canonical_name_falls_back_to_confirmed_at_when_neither_is_edited():
    earlier = make_product("Widget Pro 500", "19.99", confirmed_at=NOW)
    later = make_product("WIDGET PRO 500", "19.99", confirmed_at=NOW + timedelta(hours=1))
    result = classify_group("widget pro 500", [earlier, later])
    assert result.canonical_name == "WIDGET PRO 500"


def test_find_possible_duplicates_flags_near_matches():
    pairs = find_possible_duplicates(["widget pro 500", "wldget pro 500", "totally different item"])
    assert len(pairs) == 1
    a, b, similarity = pairs[0]
    assert {a, b} == {"widget pro 500", "wldget pro 500"}
    assert similarity >= 0.85


def test_find_possible_duplicates_ignores_dissimilar_names():
    pairs = find_possible_duplicates(["widget pro 500", "totally different item"])
    assert pairs == []


def test_find_possible_duplicates_respects_custom_threshold():
    pairs = find_possible_duplicates(["abc", "abd"], threshold=0.99)
    assert pairs == []


def test_compute_grouping_sorts_into_ready_blocked_and_possible_duplicates():
    ready_a = make_product("Widget Pro 500", "19.99")
    ready_b = make_product("WIDGET PRO 500", "19.99")
    blocked_a = make_product("Gadget X1", "10.00")
    blocked_b = make_product("GADGET X1", "12.00")
    near_a = make_product("Sprocket Deluxe", "5.00")
    near_b = make_product("Sprocket Delux", "5.00")
    lonely = make_product("Nothing Else Like This", "1.00")

    grouping = compute_grouping([ready_a, ready_b, blocked_a, blocked_b, near_a, near_b, lonely])

    assert len(grouping.ready_groups) == 1
    assert grouping.ready_groups[0].normalized_name == "widget pro 500"
    assert len(grouping.blocked_groups) == 1
    assert grouping.blocked_groups[0].normalized_name == "gadget x1"
    assert len(grouping.possible_duplicates) == 1
    key_a, key_b, similarity, members_a, members_b = grouping.possible_duplicates[0]
    assert {key_a, key_b} == {"sprocket deluxe", "sprocket delux"}
    assert similarity >= 0.85
    assert members_a[0].product_name in ("Sprocket Deluxe", "Sprocket Delux")
    assert members_b[0].product_name in ("Sprocket Deluxe", "Sprocket Delux")


def test_build_run_payload_is_json_safe_and_round_trips_member_fields():
    a = make_product("Widget Pro 500", "19.99", product_name_source="ocr", price_source="manual")
    b = make_product("WIDGET PRO 500", "19.99", updated_at=NOW + timedelta(days=1))
    grouping = compute_grouping([a, b])

    payload = build_run_payload(grouping)

    # Must be plain JSON-safe types (str/int/float/bool/None/list/dict) --
    # this is what actually gets stored in the JSONB column.
    json.dumps(payload)

    assert payload["blocked_groups"] == []
    assert payload["possible_duplicates"] == []
    assert len(payload["ready_groups"]) == 1

    group = payload["ready_groups"][0]
    assert group["status"] == "ready"
    assert group["canonical_name"] == "WIDGET PRO 500"  # b, most recently updated

    member_ids = {m["product_id"] for m in group["members"]}
    assert member_ids == {str(a.id), str(b.id)}

    member_a = next(m for m in group["members"] if m["product_id"] == str(a.id))
    assert member_a["product_name"] == "Widget Pro 500"
    assert member_a["product_name_source"] == "ocr"
    assert member_a["price_source"] == "manual"
    assert member_a["confirmed_at"] == NOW.isoformat()
    assert member_a["updated_at"] is None

    member_b = next(m for m in group["members"] if m["product_id"] == str(b.id))
    assert member_b["updated_at"] == (NOW + timedelta(days=1)).isoformat()


def test_build_run_payload_includes_possible_duplicates_with_both_sides():
    a = make_product("Sprocket Deluxe", "5.00")
    b = make_product("Sprocket Delux", "5.00")
    grouping = compute_grouping([a, b])

    payload = build_run_payload(grouping)

    assert len(payload["possible_duplicates"]) == 1
    duplicate = payload["possible_duplicates"][0]
    assert duplicate["similarity"] >= 0.85
    all_ids = {m["product_id"] for m in duplicate["group_a"]["members"]} | {m["product_id"] for m in duplicate["group_b"]["members"]}
    assert all_ids == {str(a.id), str(b.id)}
