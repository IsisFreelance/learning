import pytest

from app.confirm import FieldValidationError, resolve_field


def test_value_matching_ocr_guess_is_tagged_as_ocr():
    result = resolve_field("WIDGET PRO 500", None, "WIDGET PRO 500", "product name")
    assert result.value == "WIDGET PRO 500"
    assert result.source == "ocr"
    assert result.override_reason is None


def test_value_different_from_ocr_guess_is_tagged_as_manual():
    result = resolve_field("Widget Pro 500 (Blue)", None, "WIDGET PRO 500", "product name")
    assert result.value == "Widget Pro 500 (Blue)"
    assert result.source == "manual"


def test_value_with_no_ocr_guess_at_all_is_tagged_as_manual():
    result = resolve_field("Hand-typed name", None, None, "product name")
    assert result.source == "manual"


def test_empty_value_with_override_reason_is_tagged_as_override():
    result = resolve_field("", "price sticker was torn off", None, "price")
    assert result.value is None
    assert result.source == "override"
    assert result.override_reason == "price sticker was torn off"


def test_whitespace_only_value_counts_as_empty():
    result = resolve_field("   ", "not visible in photo", "$24.99", "price")
    assert result.value is None
    assert result.source == "override"


def test_both_empty_raises():
    with pytest.raises(FieldValidationError, match="product name"):
        resolve_field(None, None, "WIDGET PRO 500", "product name")


def test_both_empty_after_stripping_whitespace_raises():
    with pytest.raises(FieldValidationError):
        resolve_field("   ", "   ", None, "price")


def test_value_takes_priority_over_an_also_provided_override_reason():
    # If a value is present, it wins -- the override reason is only the
    # escape hatch for when there's genuinely no value to give.
    result = resolve_field("$24.99", "irrelevant reason", "$24.99", "price")
    assert result.value == "$24.99"
    assert result.source == "ocr"
    assert result.override_reason is None
