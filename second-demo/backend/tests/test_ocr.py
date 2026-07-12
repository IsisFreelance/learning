from app.ocr import (
    OcrLine,
    _lines_from_tesseract_data,
    guess_price,
    guess_title,
    preflight_status,
)


def test_guess_price_matches_a_dollar_sign_amount():
    lines = [OcrLine("WIDGET PRO 500", 90.0), OcrLine("$24.99", 85.0)]
    guess = guess_price(lines)
    assert guess.value == "$24.99"
    assert guess.confidence == 85.0
    assert guess.source == "tesseract"


def test_guess_price_matches_a_decimal_amount_without_a_dollar_sign():
    lines = [OcrLine("24.99", 70.0)]
    assert guess_price(lines).value == "24.99"


def test_guess_price_returns_no_value_when_nothing_looks_like_a_price():
    lines = [OcrLine("WIDGET PRO 500", 90.0), OcrLine("Model WP-500", 60.0)]
    guess = guess_price(lines)
    assert guess.value is None
    assert guess.confidence == 0.0


def test_guess_title_picks_the_highest_confidence_line_excluding_the_price():
    lines = [OcrLine("blurry text", 20.0), OcrLine("WIDGET PRO 500", 90.0), OcrLine("$24.99", 95.0)]
    guess = guess_title(lines, price_line_text="$24.99")
    assert guess.value == "WIDGET PRO 500"
    assert guess.confidence == 90.0


def test_guess_title_ignores_very_short_lines():
    lines = [OcrLine("ok", 99.0), OcrLine("Real Product Name", 40.0)]
    guess = guess_title(lines, price_line_text=None)
    assert guess.value == "Real Product Name"


def test_guess_title_returns_no_value_when_only_the_price_line_exists():
    lines = [OcrLine("$24.99", 95.0)]
    guess = guess_title(lines, price_line_text="$24.99")
    assert guess.value is None


def test_lines_from_tesseract_data_groups_words_into_lines_and_averages_confidence():
    data = {
        "text": ["Widget", "Pro", "500", "", "$24.99"],
        "conf": [90, 80, 70, -1, 85],
        "block_num": [1, 1, 1, 1, 2],
        "par_num": [1, 1, 1, 1, 1],
        "line_num": [1, 1, 1, 1, 1],
    }
    lines = _lines_from_tesseract_data(data)
    assert len(lines) == 2
    assert lines[0].text == "Widget Pro 500"
    assert lines[0].confidence == 80.0  # (90 + 80 + 70) / 3
    assert lines[1].text == "$24.99"


def test_lines_from_tesseract_data_skips_empty_and_non_text_regions():
    data = {"text": ["", "  "], "conf": [-1, 50], "block_num": [1, 1], "par_num": [1, 1], "line_num": [1, 2]}
    assert _lines_from_tesseract_data(data) == []


def test_preflight_status_cached_wins_regardless_of_dimensions():
    status, reason = preflight_status(is_cached=True, width=10, height=10)
    assert status == "cached"
    assert reason is None


def test_preflight_status_blocked_for_low_resolution():
    status, reason = preflight_status(is_cached=False, width=100, height=100)
    assert status == "blocked"
    assert reason is not None


def test_preflight_status_available_for_normal_resolution():
    status, reason = preflight_status(is_cached=False, width=800, height=600)
    assert status == "available"
    assert reason is None


def test_preflight_status_available_when_dimensions_are_unknown():
    # Items uploaded before Phase 2 have no recorded width/height —
    # skip the resolution check rather than guessing.
    status, reason = preflight_status(is_cached=False, width=None, height=None)
    assert status == "available"
    assert reason is None
