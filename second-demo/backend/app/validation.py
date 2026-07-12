from io import BytesIO

from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB
MAX_IMAGE_PIXELS = 40_000_000  # ~40 megapixels — generous for a real photo, well below bomb territory
MIME_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
MIME_TO_PIL_FORMAT = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
ALLOWED_MIME_TYPES = set(MIME_EXTENSIONS)
THUMBNAIL_MAX_WIDTH = 300
READ_CHUNK_BYTES = 1024 * 1024  # 1 MiB


class UploadValidationError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


async def read_upload_within_limit(file: UploadFile) -> bytes:
    # Reading in bounded chunks and aborting the moment the limit is
    # crossed — a single `await file.read()` would buffer the *entire*
    # request body first regardless of size, before any size check ever
    # runs, letting an attacker force a multi-GB read on every request.
    chunks = bytearray()
    while True:
        chunk = await file.read(READ_CHUNK_BYTES)
        if not chunk:
            break
        chunks.extend(chunk)
        if len(chunks) > MAX_FILE_SIZE_BYTES:
            raise UploadValidationError(f"File is too large — max {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB.")
    return bytes(chunks)


def validate_upload(content: bytes, declared_mime_type: str) -> None:
    if len(content) == 0:
        raise UploadValidationError("File is empty.")
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise UploadValidationError(f"File is too large — max {MAX_FILE_SIZE_BYTES // (1024 * 1024)}MB.")
    if declared_mime_type not in ALLOWED_MIME_TYPES:
        raise UploadValidationError(f"Unsupported file type: {declared_mime_type}.")

    # Never trust the declared content-type alone — actually decode the
    # bytes as an image. Catches a disguised non-image file (e.g. a script
    # renamed to .jpg) that the content-type check above would miss.
    try:
        image = Image.open(BytesIO(content))

        # Image.open() only reads the header at this point (cheap) — width
        #/height are known without decoding pixel data yet. Checked as our
        # own explicit business rule rather than relying on Pillow's default
        # DecompressionBombError threshold, which only fires above 2x
        # MAX_IMAGE_PIXELS (~179MP) — anything from ~89MP-179MP would
        # otherwise pass with just a non-fatal warning and still get fully
        # decoded (100+ MB in memory) below and in make_thumbnail().
        if image.width * image.height > MAX_IMAGE_PIXELS:
            raise UploadValidationError("Image dimensions are too large.")

        # Confirms the bytes actually decode as *this* format, not just
        # *some* image format — otherwise a real PNG declared as image/jpeg
        # would sail through and get stored with a mismatched extension and
        # content-type.
        if image.format != MIME_TO_PIL_FORMAT[declared_mime_type]:
            raise UploadValidationError("File contents don't match the declared file type.")

        image.verify()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as err:
        raise UploadValidationError("File is not a valid image.") from err


def make_thumbnail(content: bytes) -> bytes:
    # A fresh Image.open() here, not reusing the one from validate_upload()
    # above — Pillow's .verify() leaves that instance unusable afterward.
    image = Image.open(BytesIO(content))
    image = image.convert("RGB")
    image.thumbnail((THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_WIDTH))
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()
