from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.normalization import (
    ProductRecord,
    classify_group,
    find_possible_duplicates,
    group_by_name,
    normalize_name,
    normalize_price,
)

NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def make_product(name, price, confirmed_at=NOW, updated_at=None):
    return ProductRecord(id=uuid4(), product_name=name, price=price, confirmed_at=confirmed_at, updated_at=updated_at)


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
