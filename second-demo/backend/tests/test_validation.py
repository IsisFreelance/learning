import asyncio
from io import BytesIO

import pytest
from PIL import Image

from app.validation import (
    MAX_FILE_SIZE_BYTES,
    UploadValidationError,
    make_thumbnail,
    read_upload_within_limit,
    validate_upload,
)


def _real_jpeg_bytes(size=(800, 600)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", size, color=(120, 180, 200)).save(buffer, format="JPEG")
    return buffer.getvalue()


class FakeUploadFile:
    """A minimal stand-in for FastAPI's UploadFile — just enough of the
    async .read(size) interface for read_upload_within_limit to use."""

    def __init__(self, content: bytes, chunk_size: int = 1024 * 1024):
        self._content = content
        self._pos = 0
        self._chunk_size = chunk_size

    async def read(self, size: int) -> bytes:
        chunk = self._content[self._pos : self._pos + size]
        self._pos += len(chunk)
        return chunk


def test_accepts_a_real_image():
    validate_upload(_real_jpeg_bytes(), "image/jpeg")  # should not raise


def test_rejects_oversized_file():
    oversized = b"\x00" * (MAX_FILE_SIZE_BYTES + 1)
    with pytest.raises(UploadValidationError, match="too large"):
        validate_upload(oversized, "image/jpeg")


def test_rejects_unsupported_declared_type():
    with pytest.raises(UploadValidationError, match="Unsupported file type"):
        validate_upload(_real_jpeg_bytes(), "application/pdf")


def test_rejects_a_disguised_non_image_file():
    fake_image = b"this is not actually an image, just renamed"
    with pytest.raises(UploadValidationError, match="not a valid image"):
        validate_upload(fake_image, "image/jpeg")


def test_rejects_empty_file():
    with pytest.raises(UploadValidationError, match="empty"):
        validate_upload(b"", "image/jpeg")


def test_rejects_dimensions_above_our_own_cap_but_below_pillows_hard_limit():
    # Pillow's own DecompressionBombError only fires above 2x its default
    # MAX_IMAGE_PIXELS (~179 megapixels) -- below that it's just a warning.
    # 10000x10000 (100MP) sits above *our* 40MP cap but under Pillow's own
    # hard limit, so this specifically exercises our explicit check rather
    # than piggybacking on Pillow's.
    buffer = BytesIO()
    Image.new("RGB", (10000, 10000)).save(buffer, format="PNG")
    oversized_bytes = buffer.getvalue()
    assert len(oversized_bytes) < MAX_FILE_SIZE_BYTES

    with pytest.raises(UploadValidationError, match="dimensions are too large"):
        validate_upload(oversized_bytes, "image/png")


def test_rejects_a_true_decompression_bomb_instead_of_crashing():
    # Well beyond even Pillow's own hard limit -- Image.open() itself raises
    # DecompressionBombError here, before our explicit dimension check ever
    # runs. The point of this test is simply that it's caught cleanly (a
    # normal UploadValidationError) instead of crashing the request.
    buffer = BytesIO()
    Image.new("RGB", (20000, 20000)).save(buffer, format="PNG")
    bomb_bytes = buffer.getvalue()
    assert len(bomb_bytes) < MAX_FILE_SIZE_BYTES

    with pytest.raises(UploadValidationError):
        validate_upload(bomb_bytes, "image/png")


def test_rejects_content_that_doesnt_match_the_declared_type():
    # A real PNG, declared as image/jpeg -- format-confusion, not garbage.
    buffer = BytesIO()
    Image.new("RGB", (100, 100)).save(buffer, format="PNG")
    png_bytes = buffer.getvalue()

    with pytest.raises(UploadValidationError, match="don't match the declared file type"):
        validate_upload(png_bytes, "image/jpeg")


def test_thumbnail_is_smaller_and_still_a_real_image():
    original = _real_jpeg_bytes(size=(2000, 1000))
    thumb_bytes = make_thumbnail(original)

    thumb = Image.open(BytesIO(thumb_bytes))
    assert thumb.width <= 300
    assert len(thumb_bytes) < len(original)


def test_read_upload_within_limit_returns_full_content_when_under_the_cap():
    content = _real_jpeg_bytes()
    result = asyncio.run(read_upload_within_limit(FakeUploadFile(content)))
    assert result == content


def test_read_upload_within_limit_aborts_early_for_an_oversized_stream():
    # Simulates a request body far bigger than the cap — the important
    # behavior is that this raises instead of buffering the whole thing.
    oversized_stream = FakeUploadFile(b"\x00" * (MAX_FILE_SIZE_BYTES * 3))
    with pytest.raises(UploadValidationError, match="too large"):
        asyncio.run(read_upload_within_limit(oversized_stream))
